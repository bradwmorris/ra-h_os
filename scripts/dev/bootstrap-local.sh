#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_TEMPLATE="${REPO_DIR}/.env.example"
TARGET_ENV="${REPO_DIR}/.env.local"
SQLITE_SEED_SCRIPT="${REPO_DIR}/scripts/database/sqlite-ensure-app-schema.sh"

log() {
  echo "[bootstrap-local] $1"
}

# Check Node.js version (require 18+)
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js 18+ required (found v$NODE_VERSION or not installed)" >&2
  echo "Install from: https://nodejs.org" >&2
  exit 1
fi
log "Node.js v$NODE_VERSION detected ✓"

if [ ! -f "$ENV_TEMPLATE" ]; then
  echo "Error: ${ENV_TEMPLATE} not found. Make sure .env.example exists." >&2
  exit 1
fi

if [ -f "$TARGET_ENV" ]; then
  log ".env.local already exists; leaving it untouched."
else
  log "Creating .env.local from template..."
  cp "$ENV_TEMPLATE" "$TARGET_ENV"
fi

SQLITE_DB_PATH_LINE=$(grep -E '^SQLITE_DB_PATH=' "$TARGET_ENV" | tail -n 1 || true)
DEFAULT_DB_PATH="$HOME/Library/Application Support/RA-H/db/rah.sqlite"
if [ -z "$SQLITE_DB_PATH_LINE" ]; then
  SQLITE_DB_PATH="$DEFAULT_DB_PATH"
else
  SQLITE_DB_PATH="${SQLITE_DB_PATH_LINE#SQLITE_DB_PATH=}"
fi

# Expand variables like $HOME or ~
EXPANDED_DB_PATH=$(eval "echo \"$SQLITE_DB_PATH\"")
DB_DIR=$(dirname "$EXPANDED_DB_PATH")

log "Ensuring database directory exists: $DB_DIR"
mkdir -p "$DB_DIR"

if [ ! -f "$EXPANDED_DB_PATH" ]; then
  log "Creating empty SQLite database at $EXPANDED_DB_PATH"
  : > "$EXPANDED_DB_PATH"
else
  log "SQLite database already exists at $EXPANDED_DB_PATH"
fi

if [ ! -x "$SQLITE_SEED_SCRIPT" ]; then
  echo "Error: $SQLITE_SEED_SCRIPT not found or not executable" >&2
  exit 1
fi

log "Seeding database schema via sqlite-ensure-app-schema.sh"
"$SQLITE_SEED_SCRIPT" "$EXPANDED_DB_PATH"

log "Bootstrap complete. Run 'npm run dev' to start the app."
