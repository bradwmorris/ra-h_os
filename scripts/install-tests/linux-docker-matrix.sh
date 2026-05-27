#!/usr/bin/env bash
# Runs scripts/install.sh in disposable Docker containers across a matrix of distros.
# Host is never touched — containers use --rm and any repo mount is read-only.
#
# Env vars:
#   REF=main                              GitHub ref for remote mode
#   MODE=remote|local                     remote = curl from REF; local = mount working copy
#   PROFILE=openai|qwen-local|llama-cpp   --profile passed to install.sh
#                                         openai: smoke test (default, all distros)
#                                         qwen-local: REAL Ollama install + ~3GB pull;
#                                           needs ALLOW_HEAVY=1, defaults to one distro
#                                         llama-cpp: inline mock server by default;
#                                           with ALLOW_HEAVY=1 a REAL llama-server + models
#   ALLOW_HEAVY=1                         run heavy paths: qwen-local (~3GB models) and
#                                           real llama-cpp (server + GGUF downloads)
#   DISTROS="ubuntu:24.04|apt debian:12|apt"   space-separated image|pm overrides
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REF="${REF:-main}"
MODE="${MODE:-remote}"
PROFILE="${PROFILE:-openai}"

case "$PROFILE" in
  openai|qwen-local|llama-cpp) ;;
  *) echo "PROFILE must be openai|qwen-local|llama-cpp (got: $PROFILE)" >&2; exit 1 ;;
esac

# qwen-local does a REAL Ollama install and pulls ~3GB of models per distro.
# Gate it behind ALLOW_HEAVY=1 so it never runs by accident (e.g. in CI).
if [[ "$PROFILE" == "qwen-local" && "${ALLOW_HEAVY:-0}" != "1" ]]; then
  echo "PROFILE=qwen-local installs Ollama and pulls ~3GB of models per distro." >&2
  echo "Re-run with ALLOW_HEAVY=1 to confirm. Tip: DISTROS=\"ubuntu:24.04|apt\" limits it to one distro." >&2
  exit 2
fi

# Real llama-cpp (ALLOW_HEAVY=1) downloads a server + models; treat it as heavy.
LLAMACPP_REAL=false
[[ "$PROFILE" == "llama-cpp" && "${ALLOW_HEAVY:-0}" == "1" ]] && LLAMACPP_REAL=true

if [[ -n "${DISTROS:-}" ]]; then
  read -ra DISTROS_ARR <<< "$DISTROS"
elif [[ "$PROFILE" == "qwen-local" || "$LLAMACPP_REAL" == "true" ]]; then
  # Heavy profiles (real model downloads) default to one distro.
  DISTROS_ARR=("ubuntu:24.04|apt")
else
  DISTROS_ARR=(
    "ubuntu:24.04|apt"
    "ubuntu:22.04|apt"
    "debian:12|apt"
    "fedora:40|dnf"
  )
fi

APT_BOOTSTRAP='apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates >/dev/null'
DNF_BOOTSTRAP='dnf install -y -q curl git ca-certificates >/dev/null'

# Extra deps per llama-cpp variant: real needs unzip + llama.cpp runtime libs;
# mock needs python3 for the inline /v1/models server.
if [[ "$LLAMACPP_REAL" == "true" ]]; then
  # Prebuilt llama-server (ubuntu-x64 .tar.gz) needs OpenMP + libcurl at runtime.
  APT_BOOTSTRAP="$APT_BOOTSTRAP && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libgomp1 libcurl4 >/dev/null"
  DNF_BOOTSTRAP="$DNF_BOOTSTRAP && dnf install -y -q libgomp libcurl >/dev/null"
elif [[ "$PROFILE" == "llama-cpp" ]]; then
  APT_BOOTSTRAP="$APT_BOOTSTRAP && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-minimal >/dev/null"
  DNF_BOOTSTRAP="$DNF_BOOTSTRAP && dnf install -y -q python3 >/dev/null"
fi

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

if [[ "$MODE" == "remote" ]]; then
  INSTALL_CMD="curl -fsSL https://raw.githubusercontent.com/bradwmorris/ra-h_os/$REF/scripts/install.sh | bash -s -- --profile $PROFILE --yes"
elif [[ "$MODE" == "local" ]]; then
  INSTALL_CMD="bash /work/scripts/install.sh --profile $PROFILE --yes"
else
  echo "MODE must be 'remote' or 'local' (got: $MODE)" >&2
  exit 1
fi

# For llama-cpp, install.sh probes /v1/models on the LLM + embedding ports and
# aborts if nothing answers. PREP brings those ports up before the installer:
#   - default: a tiny inline mock on 8080/8081 (mirrors fixtures/llama-cpp-mock-server.py)
#   - ALLOW_HEAVY=1: a REAL llama-server + models via llama-real-setup.sh
PREP=""
if [[ "$LLAMACPP_REAL" == "true" ]]; then
  if [[ "$MODE" == "local" ]]; then
    PREP="bash /work/scripts/install-tests/llama-real-setup.sh && "
  else
    PREP="curl -fsSL https://raw.githubusercontent.com/bradwmorris/ra-h_os/$REF/scripts/install-tests/llama-real-setup.sh | bash && "
  fi
elif [[ "$PROFILE" == "llama-cpp" ]]; then
  # The mock server is wrapped in a subshell — `( ... & )` — so the trailing `&`
  # backgrounds ONLY python, not the whole `bootstrap && cd && ...` chain in front
  # of it (`&` binds looser than `&&`, so a bare `python & ` would background the
  # apt git-install too, and install.sh would race ahead without git).
  PREP="( python3 -c \"import http.server,socketserver,threading; H=type('H',(http.server.BaseHTTPRequestHandler,),{'do_GET':lambda s:(s.send_response(200),s.end_headers(),s.wfile.write(b'{}')),'log_message':lambda s,*a:None}); [threading.Thread(target=lambda p=p: socketserver.TCPServer(('127.0.0.1',p),H).serve_forever(),daemon=True).start() for p in (8080,8081)]; import time; time.sleep(86400)\" & ) && for i in 1 2 3 4 5; do curl -sf http://127.0.0.1:8080/v1/models >/dev/null 2>&1 && curl -sf http://127.0.0.1:8081/v1/models >/dev/null 2>&1 && break; sleep 1; done && "
fi

LOG_DIR="${LOG_DIR:-$REPO_ROOT/scripts/install-tests/logs/$(date +%Y%m%d-%H%M%S)-linux-$MODE-$PROFILE}"
mkdir -p "$LOG_DIR"
echo "Per-distro logs: $LOG_DIR"

results=()

for entry in "${DISTROS_ARR[@]}"; do
  image="${entry%|*}"
  pm="${entry#*|}"
  case "$pm" in
    apt) bootstrap="$APT_BOOTSTRAP" ;;
    dnf) bootstrap="$DNF_BOOTSTRAP" ;;
    *)   echo "Unknown package manager '$pm' for $image — skipping" >&2; results+=("SKIP  $image (unknown pm)"); continue ;;
  esac

  log_file="$LOG_DIR/${image//[:\/]/-}.log"

  echo ""
  echo "=== $image  (mode=$MODE, profile=$PROFILE, ref=$REF) ==="
  echo "    log: $log_file"

  docker_args=(run --rm -e OPENAI_API_KEY=sk-test-placeholder)
  [[ "$MODE" == "local" ]] && docker_args+=(-v "$REPO_ROOT:/work:ro")

  # tee streams live AND captures to file; PIPESTATUS preserves docker's exit code through the pipe
  docker "${docker_args[@]}" "$image" bash -c "$bootstrap && cd /tmp && $PREP$INSTALL_CMD" 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}

  if [[ "$status" -eq 0 ]]; then
    results+=("PASS  $image  ($log_file)")
  else
    results+=("FAIL  $image  ($log_file)")
  fi
done

echo ""
echo "=== Summary ==="
printf '  %s\n' "${results[@]}"

if printf '%s\n' "${results[@]}" | grep -q '^FAIL'; then
  exit 1
fi
