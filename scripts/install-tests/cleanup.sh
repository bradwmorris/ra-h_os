#!/usr/bin/env bash
# Removes all artifacts created by the installer test harness:
#   - rah-test:* Docker images (Tier 2 pre-seeded images)
#   - Base distro images used by the test matrix
#     (ubuntu:24.04, ubuntu:22.04, debian:12, fedora:40)
#   - Test log directories: repo scripts/install-tests/logs/* (Windows + Linux)
#     and legacy /tmp/rah-install-tests/
#   - Top-level test log files under /tmp/rah-*.log
#
# With --with-build-cache, also runs `docker builder prune -af`
# (shared across ALL your docker work, so opt-in).
#
# Shows an inventory and asks for confirmation by default. Pass --yes to skip.
#
# Usage:
#   ./scripts/install-tests/cleanup.sh                    # default — prompts
#   ./scripts/install-tests/cleanup.sh --yes              # skip prompt
#   ./scripts/install-tests/cleanup.sh --with-build-cache # also prune build cache
#   ./scripts/install-tests/cleanup.sh --dry-run          # show, do nothing
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

YES=false
DRY_RUN=false
WITH_BUILD_CACHE=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y)            YES=true ;;
    --dry-run)           DRY_RUN=true ;;
    --with-build-cache)  WITH_BUILD_CACHE=true ;;
    -h|--help)
      sed -n '2,/^set -/p' "$0" | sed 's/^# \{0,1\}//' | head -n -1
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

# ── Inventory ───────────────────────────────────────────────────────────────
RAH_IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep '^rah-test:' || true)
BASE_IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | grep -E '^(ubuntu:24\.04|ubuntu:22\.04|debian:12|fedora:40)$' || true)
LOG_DIRS=$( { find "$SCRIPT_DIR/logs" -mindepth 1 -maxdepth 1 -type d 2>/dev/null; find /tmp -maxdepth 1 -type d -name 'rah-install-tests*' 2>/dev/null; } || true)
LOG_FILES=$(find /tmp -maxdepth 1 -type f \( -name 'rah-*.log' -o -name 'rah-matrix.log' -o -name 'rah-qwen-*.log' -o -name 'rah-edge-*.log' \) 2>/dev/null || true)

echo "=== Installer test cleanup ==="
$DRY_RUN && echo "(dry run — nothing will be removed)"
echo ""

echo "Will remove:"
echo ""
echo "  Docker images (rah-test:*):"
if [[ -n "$RAH_IMAGES" ]]; then printf '    %s\n' $RAH_IMAGES; else echo "    (none)"; fi
echo ""
echo "  Docker images (base distros):"
if [[ -n "$BASE_IMAGES" ]]; then printf '    %s\n' $BASE_IMAGES; else echo "    (none)"; fi
echo ""
echo "  Log directories (repo logs/* + /tmp/rah-install-tests*):"
if [[ -n "$LOG_DIRS" ]]; then printf '    %s\n' $LOG_DIRS; else echo "    (none)"; fi
echo ""
echo "  Log files (/tmp/rah-*.log):"
if [[ -n "$LOG_FILES" ]]; then printf '    %s\n' $LOG_FILES; else echo "    (none)"; fi

if $WITH_BUILD_CACHE; then
  echo ""
  echo "  Docker build cache (--with-build-cache): yes — affects ALL your docker work"
fi

# Exit early if nothing to do
if [[ -z "$RAH_IMAGES$BASE_IMAGES$LOG_DIRS$LOG_FILES" ]] && ! $WITH_BUILD_CACHE; then
  echo ""
  echo "Nothing to remove."
  exit 0
fi

# ── Confirm ─────────────────────────────────────────────────────────────────
if ! $DRY_RUN && ! $YES; then
  echo ""
  read -rp "Proceed? [y/N] " ans </dev/tty || true
  [[ "$ans" =~ ^[Yy] ]] || { echo "Aborted."; exit 0; }
fi

$DRY_RUN && { echo ""; echo "Dry run complete."; exit 0; }

# ── Remove ──────────────────────────────────────────────────────────────────
remove_count=0

if [[ -n "$RAH_IMAGES" ]]; then
  echo ""
  echo "Removing rah-test images..."
  echo "$RAH_IMAGES" | xargs -r docker rmi -f && remove_count=$((remove_count+1)) || true
fi

if [[ -n "$BASE_IMAGES" ]]; then
  echo ""
  echo "Removing base distro images..."
  echo "$BASE_IMAGES" | xargs -r docker rmi -f && remove_count=$((remove_count+1)) || true
fi

if [[ -n "$LOG_DIRS" ]]; then
  echo ""
  echo "Removing log directories..."
  echo "$LOG_DIRS" | xargs -r rm -rf && remove_count=$((remove_count+1))
fi

if [[ -n "$LOG_FILES" ]]; then
  echo ""
  echo "Removing log files..."
  echo "$LOG_FILES" | xargs -r rm -f && remove_count=$((remove_count+1))
fi

if $WITH_BUILD_CACHE; then
  echo ""
  echo "Pruning Docker build cache..."
  docker builder prune -af
fi

echo ""
echo "Cleanup complete."
