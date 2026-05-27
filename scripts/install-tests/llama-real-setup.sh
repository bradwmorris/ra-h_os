#!/usr/bin/env bash
# Provisions a REAL (not mocked) llama.cpp setup for testing the llama-cpp
# profile end to end: downloads a prebuilt llama-server plus two small GGUF
# models, then starts an LLM server on 8080 and an embedding server on 8081 --
# the ports install.sh / install.ps1 default to.
#
# Heavy: pulls a llama.cpp release zip (~tens of MB) and ~0.5 GB of models, and
# loads them in CPU. Intended to run inside a disposable container/sandbox,
# gated behind ALLOW_HEAVY=1 by the callers. Never run this on a host you care
# about leaving clean.
#
# All URLs are overridable so the test survives upstream renames/removals:
#   LLAMACPP_ASSET_RE   regex matching the linux x64 release asset name
#   CHAT_GGUF_URL       small instruct GGUF served on the LLM port (8080)
#   EMBED_GGUF_URL      embedding GGUF served on the embedding port (8081)
set -euo pipefail

LLAMACPP_ASSET_RE="${LLAMACPP_ASSET_RE:-bin-ubuntu-x64\.tar\.gz}"
CHAT_GGUF_URL="${CHAT_GGUF_URL:-https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf}"
EMBED_GGUF_URL="${EMBED_GGUF_URL:-https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf}"

WORK="${WORK:-/tmp/llama-real}"
mkdir -p "$WORK"
say() { echo "[llama-real] $*"; }

# -- llama-server binary ------------------------------------------------------
# The very latest release sometimes hasn't finished uploading the plain CPU x64
# build, so search the most recent releases (newest-first) and take the first
# matching REAL asset (grep only browser_download_url, not the body's markdown
# links). This auto-falls-back past an incomplete latest release.
say "Resolving llama.cpp release asset (~ /$LLAMACPP_ASSET_RE/)..."
asset_url=$(curl -fsSL "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15" \
  | grep -oE '"browser_download_url": *"[^"]+"' | grep -oE 'https://[^"]+' \
  | grep -E "$LLAMACPP_ASSET_RE" | head -1)
[[ -n "$asset_url" ]] || { echo "[llama-real] no release asset matched /$LLAMACPP_ASSET_RE/ in recent releases" >&2; exit 1; }
say "Downloading $asset_url"
curl -fsSL "$asset_url" -o "$WORK/llama.tgz"
mkdir -p "$WORK/llama"
tar -xzf "$WORK/llama.tgz" -C "$WORK/llama"
SERVER=$(find "$WORK/llama" -type f -name 'llama-server' | head -1)
[[ -n "$SERVER" ]] || { echo "[llama-real] llama-server not found in release zip" >&2; exit 1; }
chmod +x "$SERVER"
# Prebuilt binaries ship their shared libs alongside the executable.
export LD_LIBRARY_PATH="$(dirname "$SERVER"):${LD_LIBRARY_PATH:-}"
say "llama-server: $SERVER"

# -- models -------------------------------------------------------------------
say "Downloading chat model..."
curl -fsSL "$CHAT_GGUF_URL"  -o "$WORK/chat.gguf"
say "Downloading embedding model..."
curl -fsSL "$EMBED_GGUF_URL" -o "$WORK/embed.gguf"

# -- start servers ------------------------------------------------------------
say "Starting LLM server on 8080..."
nohup "$SERVER" -m "$WORK/chat.gguf"  --host 127.0.0.1 --port 8080 -c 512 >"$WORK/llm.log"   2>&1 &
say "Starting embedding server on 8081..."
nohup "$SERVER" -m "$WORK/embed.gguf" --host 127.0.0.1 --port 8081 --embedding -c 512 >"$WORK/embed.log" 2>&1 &

say "Waiting for both servers to answer /v1/models..."
for i in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8080/v1/models >/dev/null 2>&1 \
     && curl -sf http://127.0.0.1:8081/v1/models >/dev/null 2>&1; then
    say "Both llama.cpp servers are up."
    exit 0
  fi
  sleep 2
done
echo "[llama-real] servers did not become reachable in time. Logs:" >&2
tail -n 20 "$WORK/llm.log" "$WORK/embed.log" >&2 || true
exit 1
