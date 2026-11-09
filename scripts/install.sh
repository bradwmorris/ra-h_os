#!/usr/bin/env bash
# One-line installer for RA-H OS (Linux / macOS)
# Usage: curl -fsSL https://raw.githubusercontent.com/bradwmorris/ra-h_os/main/scripts/install.sh | bash
# Or with options: curl ... | bash -s -- --profile qwen-local --llm-port 8080 --embedding-port 8081
set -euo pipefail

REPO_URL="https://github.com/bradwmorris/ra-h_os.git"
INSTALL_DIR="${INSTALL_DIR:-ra-h_os}"
PROFILE="openai"
LLM_PORT="8080"
EMBEDDING_PORT="8081"
YES="false"

_usage() {
  echo "Usage: install.sh [--profile openai|qwen-local|llama-cpp] [--dir DIR] [--llm-port PORT] [--embedding-port PORT] [--yes|-y]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)        [[ -n "${2:-}" ]] || _usage; PROFILE="$2";        shift 2 ;;
    --dir)            [[ -n "${2:-}" ]] || _usage; INSTALL_DIR="$2";    shift 2 ;;
    --llm-port)       [[ -n "${2:-}" ]] || _usage; LLM_PORT="$2";       shift 2 ;;
    --embedding-port) [[ -n "${2:-}" ]] || _usage; EMBEDDING_PORT="$2"; shift 2 ;;
    --yes|-y)         YES="true";          shift   ;;
    *) echo "Unknown option: $1"; _usage ;;
  esac
done

case "$PROFILE" in
  openai|qwen-local|llama-cpp) ;;
  *) echo "Invalid --profile: '$PROFILE' (expected openai, qwen-local or llama-cpp)" >&2; _usage ;;
esac

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
info()  { echo -e "${GREEN}[ra-h]${NC} $*"; }
warn()  { echo -e "${YELLOW}[ra-h]${NC} $*"; }
error() { echo -e "${RED}[ra-h] ERROR:${NC} $*" >&2; exit 1; }
ask()   {
  [[ "$YES" == "true" ]] && return 0
  local _a
  read -rp $'\033[0;32m[ra-h]\033[0m '"$1"$' [y/N] ' _a </dev/tty || true
  [[ "$_a" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# ── git check ────────────────────────────────────────────────────────────────

command -v git >/dev/null 2>&1 || error "git is required but not installed. See https://git-scm.com"

# ── Node.js check ────────────────────────────────────────────────────────────

# Set when this run selects Node via nvm. Under `curl | bash` that only changes this
# child shell's PATH, so the printed start command must carry the Node bin dir.
_NODE_VIA_NVM=false

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  warn "Node.js is not installed."
  # Source nvm if already present but not yet loaded in this shell
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  if command -v nvm >/dev/null 2>&1; then
    info "nvm detected — using it to install Node.js v22..."
    nvm install 22
    nvm use 22
    _NODE_VIA_NVM=true
  elif ask "Install Node.js v22 via nvm now?"; then
    info "Installing nvm and Node.js v22..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm use 22
    _NODE_VIA_NVM=true
  else
    error "Node.js v22+ is required. Install from https://nodejs.org then re-run."
  fi
  command -v node >/dev/null 2>&1 || error "Node.js installation failed. Install manually from https://nodejs.org"
fi

# The app requires Node 22+ (package.json engines, bootstrap-local.mjs), so only the
# major version matters. Suffix stripping keeps pre-release tags such as
# "22.12.0-rc.1" from breaking bash arithmetic under set -e.
_node_major() {
  local _major
  IFS=. read -r _major _ <<< "$(node -p 'process.versions.node')"
  echo "${_major%%[!0-9]*}"
}

NODE_MAJOR="$(_node_major)"
if [[ "${NODE_MAJOR:-0}" -lt 22 ]]; then
  # Node exists but is too old — attempt upgrade via nvm before giving up
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  if command -v nvm >/dev/null 2>&1; then
    warn "Node.js $(node -v) is too old — upgrading to v22 via nvm..."
    nvm install 22
    nvm use 22
    _NODE_VIA_NVM=true
    NODE_MAJOR="$(_node_major)"
  fi
  [[ "${NODE_MAJOR:-0}" -ge 22 ]] || error "Node.js v22 or higher is required (found $(node -v)). See https://nodejs.org"
fi

# ── Clone ────────────────────────────────────────────────────────────────────

if [[ -d "$INSTALL_DIR" ]]; then
  warn "Directory '$INSTALL_DIR' already exists — pulling latest changes."
  git -C "$INSTALL_DIR" rev-parse --git-dir >/dev/null 2>&1 \
    || error "Directory '$INSTALL_DIR' exists but is not a git repository. Remove it and re-run."
  git -C "$INSTALL_DIR" pull --ff-only \
    || warn "Could not fast-forward pull (local changes or diverged history) — using existing state."
else
  info "Cloning RA-H OS into '$INSTALL_DIR'..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── Profile pre-flight ───────────────────────────────────────────────────────

_ollama_running() { curl -sf http://127.0.0.1:11434 >/dev/null 2>&1; }
_OLLAMA_BG=false

# Ollama's Linux installer uses zstd-compressed tarballs but does not check for zstd itself.
# Ensure it's present before invoking https://ollama.com/install.sh on minimal systems.
_ensure_zstd() {
  command -v zstd >/dev/null 2>&1 && return 0
  warn "zstd is required by Ollama's installer but is not installed."
  local _sudo=""
  [[ "$(id -u)" -ne 0 ]] && _sudo="sudo"
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing zstd via apt-get..."
    $_sudo apt-get update -qq && DEBIAN_FRONTEND=noninteractive $_sudo apt-get install -y -qq zstd
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing zstd via dnf..."
    $_sudo dnf install -y -q zstd
  elif command -v yum >/dev/null 2>&1; then
    info "Installing zstd via yum..."
    $_sudo yum install -y -q zstd
  elif command -v pacman >/dev/null 2>&1; then
    info "Installing zstd via pacman..."
    $_sudo pacman -Sy --noconfirm zstd
  else
    error "Could not detect a supported package manager to install zstd. Install it manually then re-run."
  fi
  command -v zstd >/dev/null 2>&1 || error "zstd installation failed. Install it manually then re-run."
}

_start_ollama() {
  info "Starting Ollama daemon..."
  _OLLAMA_BG=false
  local _ollama_pid=""
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1 && brew list ollama &>/dev/null; then
    brew services start ollama
  # /run/systemd/system exists only when systemd is the running init; WSL and containers
  # can ship systemctl and a unit file without it, and must use the nohup fallback.
  elif [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1 \
       && systemctl list-unit-files ollama.service | grep -q ollama.service; then
    if [[ "$(id -u)" -eq 0 ]]; then systemctl start ollama; else sudo systemctl start ollama; fi
  else
    nohup ollama serve >/dev/null 2>&1 &
    _ollama_pid=$!
    _OLLAMA_BG=true
  fi
  local i=0
  while [[ $i -lt 15 ]]; do _ollama_running && break; sleep 1; i=$((i+1)); done
  if ! _ollama_running; then
    if [[ -n "$_ollama_pid" ]] && kill -0 "$_ollama_pid" 2>/dev/null; then
      kill "$_ollama_pid" 2>/dev/null || true
    fi
    return 1
  fi
}

if [[ "$PROFILE" == "qwen-local" ]]; then
  # ── Install Ollama if missing ──
  if ! command -v ollama >/dev/null 2>&1; then
    warn "Ollama is not installed."
    if ask "Install Ollama now?"; then
      info "Installing Ollama..."
      if [[ "$(uname -s)" == "Darwin" ]]; then
        # Ollama's install.sh and _ensure_zstd are Linux-only; macOS needs Homebrew or the app.
        command -v brew >/dev/null 2>&1 \
          || error "Installing Ollama on macOS requires Homebrew (https://brew.sh). Alternatively install the Ollama app from https://ollama.com/download, then re-run."
        brew install ollama
      else
        _ensure_zstd
        curl -fsSL https://ollama.com/install.sh | sh
      fi
      command -v ollama >/dev/null 2>&1 || error "Ollama installation failed. Install manually from https://ollama.com"
    else
      error "Ollama is required for the qwen-local profile. Install from https://ollama.com then re-run."
    fi
  fi

  # ── Start daemon if not running ──
  if ! _ollama_running; then
    warn "Ollama daemon is not running."
    if ask "Start Ollama now?"; then
      _start_ollama || error "Ollama daemon failed to start. Run 'ollama serve' in another terminal then re-run."
      [[ "$_OLLAMA_BG" == "true" ]] && warn "Ollama running as a background process — not persistent across logout. See https://github.com/ollama/ollama/blob/main/docs/linux.md to install as a service."
      info "Ollama daemon is running."
    else
      error "Ollama must be running to pull models. Start it with: ollama serve"
    fi
  else
    info "Ollama daemon is running."
  fi

  info "Pulling qwen3:4b (utility model)..."
  ollama pull qwen3:4b

  info "Pulling qwen3-embedding:0.6b (embedding model)..."
  ollama pull qwen3-embedding:0.6b
fi

if [[ "$PROFILE" == "llama-cpp" ]]; then
  [[ "$LLM_PORT"       =~ ^[0-9]+$ ]] || error "--llm-port must be a number (got: $LLM_PORT)"
  [[ "$EMBEDDING_PORT" =~ ^[0-9]+$ ]] || error "--embedding-port must be a number (got: $EMBEDDING_PORT)"
  info "Checking llama.cpp servers (ports $LLM_PORT / $EMBEDDING_PORT)..."
  curl -sf "http://127.0.0.1:$LLM_PORT/v1/models" >/dev/null 2>&1 \
    || error "No llama.cpp server on port $LLM_PORT. Start it first:
    llama-server -m /path/to/qwen3-4b.gguf --port $LLM_PORT"
  curl -sf "http://127.0.0.1:$EMBEDDING_PORT/v1/models" >/dev/null 2>&1 \
    || error "No llama.cpp embedding server on port $EMBEDDING_PORT. Start it first:
    llama-server -m /path/to/qwen3-embedding-0.6b.gguf --embedding --port $EMBEDDING_PORT"
  info "llama.cpp servers reachable on ports $LLM_PORT and $EMBEDDING_PORT."
fi

# ── Install & setup ──────────────────────────────────────────────────────────

info "Installing dependencies..."
npm install

info "Running setup (profile: $PROFILE)..."
if [[ "$PROFILE" == "llama-cpp" ]]; then
  LLM_BASE_URL="http://127.0.0.1:$LLM_PORT/v1" \
  EMBEDDING_BASE_URL="http://127.0.0.1:$EMBEDDING_PORT/v1" \
  npm run setup:local -- --profile "$PROFILE"
else
  npm run setup:local -- --profile "$PROFILE"
fi
if [[ -f .env.local ]]; then
  chmod 600 .env.local
else
  warn ".env.local was not created by setup:local — skipping file hardening."
fi

# ── OpenAI API key ───────────────────────────────────────────────────────────

if [[ "$PROFILE" == "openai" ]]; then
  _oai_key="${OPENAI_API_KEY:-}"

  if [[ -n "$_oai_key" ]]; then
    info "OPENAI_API_KEY found in environment — writing to .env.local."
  elif grep -q "^OPENAI_API_KEY=." .env.local 2>/dev/null; then
    info "OPENAI_API_KEY already set in .env.local — skipping."
  elif [[ "$YES" == "true" ]]; then
    warn "No OPENAI_API_KEY in environment. Add it later in Settings → API Keys."
  else
    echo ""
    info "Enter your OpenAI API key to write it to .env.local now."
    info "Press Enter to skip — you can add it later in Settings → API Keys."
    read -rsp $'\033[0;32m[ra-h]\033[0m OpenAI API key: ' _oai_key </dev/tty || true
    echo ""
  fi

  if [[ -n "$_oai_key" ]]; then
    _oai_key_esc=$(printf '%s' "$_oai_key" | sed 's/[\\&|]/\\&/g')
    if grep -q "^OPENAI_API_KEY=" .env.local 2>/dev/null; then
      # Explicit check: a command before && is exempt from set -e, so a failed rewrite
      # would otherwise fall through to "saved". Keep the backup unless the write succeeded.
      if ! sed -i.bak "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$_oai_key_esc|" .env.local; then
        error "Could not update OPENAI_API_KEY in .env.local (a backup may remain at .env.local.bak)."
      fi
      rm -f .env.local.bak
    else
      printf '\nOPENAI_API_KEY=%s\n' "$_oai_key" >> .env.local  # raw key — printf doesn't interpret metacharacters
    fi
    chmod 600 .env.local
    info "OpenAI API key saved to .env.local"
  elif [[ "$YES" != "true" ]]; then
    warn "Skipped — add your key later in Settings → API Keys."
  fi
fi

# ── Vector extension check ───────────────────────────────────────────────────

if [[ "$(uname -s)" == "Darwin" ]]; then
  VEC_EXT="vendor/sqlite-extensions/vec0.dylib"
else
  VEC_EXT="vendor/sqlite-extensions/vec0.so"
fi

if [[ -f "$VEC_EXT" ]]; then
  info "sqlite-vec extension found: $VEC_EXT"
else
  warn "sqlite-vec extension not found at $VEC_EXT"
  warn "Vector search will be unavailable. Options:"
  warn "  1. Build or download vec0 for your platform and place it at $VEC_EXT"
  warn "  2. Use Qdrant as the vector backend — see QDRANT-DEPLOYMENT.md"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
info "Installation complete!"
echo ""
# %q shell-escapes paths so the printed command is copy-pasteable for paths with spaces.
if [[ "$_NODE_VIA_NVM" == "true" ]]; then
  # The caller's terminal does not have this run's nvm-selected Node on its PATH.
  printf '  Start the app:  cd %q && PATH=%q:"$PATH" npm run dev\n' \
    "$INSTALL_DIR" "$(dirname "$(command -v node)")"
else
  printf '  Start the app:  cd %q && npm run dev\n' "$INSTALL_DIR"
fi
echo "  Then open:      http://localhost:3000"
echo ""
echo "  Optional MCP setup (Claude Code / Cursor):"
echo "  npx -y ra-h-mcp-server@latest setup --client claude-code --yes"
echo ""
