#!/usr/bin/env bash
# Edge-case and regression tests for install.sh.
# Each scenario runs in its own --rm container against the local repo (read-only).
#
# Eight scenarios:
#   noenv-warns                  --yes without OPENAI_API_KEY → warning shown
#   non-git-dir-errors           existing non-git dir → clear error, non-zero exit
#   rerun-uses-pull              re-running → git pull instead of fresh clone
#   nvm-present-no-node          nvm installed but no Node → installer uses nvm silently
#   old-node-auto-upgrade        Node 18 present → installer upgrades to 20 via nvm
#   prerelease-node-tag-no-crash Node version string "20.18.1-rc.1" → no arithmetic crash
#   llama-cpp-with-mock-servers  --profile llama-cpp + custom ports → reachability check passes
#   openai-interactive-key       interactive (no --yes) key prompt via expect → key written to .env.local
#
# noenv-warns / non-git-dir-errors / rerun-uses-pull / openai-interactive-key run
# against the default base image ($IMAGE). The other four use pre-seeded images
# built from fixtures/Dockerfile.* — first run builds them (~2 min total);
# subsequent runs reuse Docker's build cache.
#
# Env vars:
#   IMAGE=ubuntu:24.04        base image for default scenarios (apt-based only)
#   LOG_DIR=/path/...         override log dir (default: repo scripts/install-tests/logs/<ts>-linux-edge)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

IMAGE="${IMAGE:-ubuntu:24.04}"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/scripts/install-tests/logs/$(date +%Y%m%d-%H%M%S)-linux-edge}"
mkdir -p "$LOG_DIR"
echo "Per-scenario logs: $LOG_DIR"

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

BOOTSTRAP='apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates >/dev/null'

# ── Build pre-seeded images ─────────────────────────────────────────────────
# Docker's layer cache makes repeat invocations near-instant; full first
# build is ~2 min (apt + nvm + Node install).
build_image() {
  local tag="$1" dockerfile="$2"
  echo ""
  if docker image inspect "$tag" >/dev/null 2>&1; then
    echo "✓ $tag — already built (delete with: docker rmi $tag to force rebuild)"
  else
    echo "Building $tag from $dockerfile ..."
    docker build -q -f "$dockerfile" -t "$tag" "$SCRIPT_DIR" >/dev/null
    echo "✓ $tag built"
  fi
}
build_image "rah-test:nvm-no-node"     "$SCRIPT_DIR/fixtures/Dockerfile.nvm-no-node"
build_image "rah-test:old-node"        "$SCRIPT_DIR/fixtures/Dockerfile.old-node"
build_image "rah-test:prerelease-node" "$SCRIPT_DIR/fixtures/Dockerfile.prerelease-node"
build_image "rah-test:llama-cpp-mock"  "$SCRIPT_DIR/fixtures/Dockerfile.llama-cpp-mock"

results=()

# run_scenario <name> <image> <expected_exit> <expect_pattern> <container_cmd>
# Streams output live and captures to a per-scenario log. PASS iff exit code
# matches AND (pattern is empty OR pattern is found in the log).
run_scenario() {
  local name="$1" image="$2" expected_exit="$3" pattern="$4" cmd="$5"
  local log="$LOG_DIR/${name}.log"

  echo ""
  echo "=== $name  (image=$image) ==="
  echo "    expect: exit=$expected_exit, pattern=\"$pattern\""
  echo "    log:    $log"

  docker run --rm -v "$REPO_ROOT:/work:ro" "$image" bash -c "$cmd" 2>&1 | tee "$log"
  local actual_exit=${PIPESTATUS[0]}

  local pattern_ok=true
  if [[ -n "$pattern" ]] && ! grep -q -- "$pattern" "$log"; then
    pattern_ok=false
  fi

  if [[ "$actual_exit" -eq "$expected_exit" ]] && $pattern_ok; then
    results+=("PASS  $name  ($log)")
  else
    results+=("FAIL  $name  exit=$actual_exit (expected $expected_exit), pattern_match=$pattern_ok  ($log)")
  fi
}

# ── Tier 1: default-image scenarios ─────────────────────────────────────────

# --yes without OPENAI_API_KEY → exit 0 + warning
run_scenario "noenv-warns" "$IMAGE" 0 "Add it later in Settings" \
  "$BOOTSTRAP && cd /tmp && bash /work/scripts/install.sh --yes"

# Existing non-git directory → exit 1 + clear error
run_scenario "non-git-dir-errors" "$IMAGE" 1 "is not a git repository" \
  "$BOOTSTRAP && mkdir -p /tmp/ra-h_os && cd /tmp && bash /work/scripts/install.sh --yes"

# Re-run in same dir → second invocation uses git pull
run_scenario "rerun-uses-pull" "$IMAGE" 0 "pulling latest changes" \
  "$BOOTSTRAP && cd /tmp \
   && OPENAI_API_KEY=sk-test-placeholder bash /work/scripts/install.sh --yes \
   && OPENAI_API_KEY=sk-test-placeholder bash /work/scripts/install.sh --yes"

# ── Tier 2: pre-seeded-image scenarios ──────────────────────────────────────

# nvm installed, no Node → install.sh uses nvm silently to install Node 20
run_scenario "nvm-present-no-node" "rah-test:nvm-no-node" 0 "nvm detected" \
  "cd /tmp && OPENAI_API_KEY=sk-test-placeholder bash /work/scripts/install.sh --yes"

# Node 18 (too old) → install.sh detects and runs nvm recovery to upgrade
run_scenario "old-node-auto-upgrade" "rah-test:old-node" 0 "is too old — upgrading to v20 via nvm" \
  "cd /tmp && OPENAI_API_KEY=sk-test-placeholder bash /work/scripts/install.sh --yes"

# Node version shim returns "20.18.1-rc.1" → suffix-strip prevents arithmetic crash
run_scenario "prerelease-node-tag-no-crash" "rah-test:prerelease-node" 0 "Installation complete" \
  "cd /tmp && OPENAI_API_KEY=sk-test-placeholder bash /work/scripts/install.sh --yes"

# llama-cpp profile with mock servers on custom ports.
#
# LIMITATION: this only asserts install.sh's reachability check uses the custom
# ports and the installer exits 0. It does NOT assert .env.local ends up with
# the custom LLM_BASE_URL / EMBEDDING_BASE_URL — bootstrap-local.mjs currently
# ignores those env vars and writes hardcoded defaults (8080/8081). Tracked at
# https://github.com/bradwmorris/ra-h_os/issues/16. Once that's fixed, extend
# this scenario to also `grep -q 'LLM_BASE_URL=http://127.0.0.1:9090/v1' .env.local`.
run_scenario "llama-cpp-with-mock-servers" "rah-test:llama-cpp-mock" 0 "llama.cpp servers reachable on ports 9090 and 9091" \
  "llama-cpp-mock-server 9090 9091 & \
   for i in 1 2 3 4 5; do \
     curl -sf http://127.0.0.1:9090/v1/models >/dev/null 2>&1 \
       && curl -sf http://127.0.0.1:9091/v1/models >/dev/null 2>&1 && break; \
     sleep 1; \
   done && \
   cd /tmp && OPENAI_API_KEY=sk-test-placeholder bash /work/scripts/install.sh \
     --profile llama-cpp --llm-port 9090 --embedding-port 9091 --yes"

# Interactive OpenAI-key entry: no --yes, no env key → install.sh prompts for the
# key via `read -rsp ... </dev/tty`. Driven under a pty by expect (see
# fixtures/openai-interactive.exp), which answers the Node-install prompt then
# the hidden key prompt. Asserts the key is written to .env.local. This is the
# automated cover for the two "interactive — not automated" test-plan items.
run_scenario "openai-interactive-key" "$IMAGE" 0 "OpenAI API key saved to .env.local" \
  "$BOOTSTRAP && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq expect >/dev/null \
   && tr -d '\r' < /work/scripts/install-tests/fixtures/openai-interactive.exp > /tmp/oi.exp \
   && expect /tmp/oi.exp \
   && grep -q '^OPENAI_API_KEY=sk-test-interactive-123\$' /tmp/ra-h_os/.env.local"

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
printf '  %s\n' "${results[@]}"

if printf '%s\n' "${results[@]}" | grep -q '^FAIL'; then
  exit 1
fi
