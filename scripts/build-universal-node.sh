#!/usr/bin/env bash
set -euo pipefail

# Build a universal (arm64 + x86_64) Node.js runtime staged inside dist/runtime/node-universal.
# The script downloads the official macOS tarballs for each architecture, combines the Mach-O
# binaries with lipo, and leaves the result ready to be copied into the packaged app.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Node 22+ is required (package.json engines, better-sqlite3 v13). Pin the current Active LTS;
# keep the fallback in scripts/build-production.sh (write_version_file) in sync.
NODE_VERSION="${NODE_VERSION:-24.22.2}"
CACHE_ROOT="${NODE_CACHE_DIR:-$HOME/.cache/ra-h/node}"
OUTPUT_ROOT="${NODE_OUTPUT_DIR:-$REPO_ROOT/dist/runtime/node-universal}"
STAGING_ROOT="${NODE_STAGING_DIR:-$REPO_ROOT/dist/.staging/node-universal}"

ARM_ARCH="arm64"
X64_ARCH="x64"

ARM_TARBALL="node-v${NODE_VERSION}-darwin-${ARM_ARCH}"
X64_TARBALL="node-v${NODE_VERSION}-darwin-${X64_ARCH}"

ensure_prerequisites() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "❌ curl not found. Install curl before running this script." >&2
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo "❌ tar not found. Install GNU tar / BSD tar before running this script." >&2
    exit 1
  fi
  if ! command -v rsync >/dev/null 2>&1; then
    echo "❌ rsync not found. Install rsync before running this script." >&2
    exit 1
  fi
  if ! command -v lipo >/dev/null 2>&1; then
    echo "❌ lipo not found. Install Xcode command line tools (xcode-select --install)." >&2
    exit 1
  fi
}

download_node() {
  local tarball_name="$1"
  local archive_dir="$CACHE_ROOT/${tarball_name}"
  if [ -x "${archive_dir}/bin/node" ]; then
    echo "✓ Node ${tarball_name} cached at ${archive_dir}"
    return
  fi

  mkdir -p "$CACHE_ROOT"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball_name}.tar.gz"
  echo "⬇️  Downloading ${url}"
  tmp_archive="$(mktemp -d -t node-archive-XXXX)"
  trap 'rm -rf "$tmp_archive"' EXIT
  curl -fsSL "$url" | tar xz -C "$tmp_archive"
  mv "${tmp_archive}/${tarball_name}" "$archive_dir"
  rm -rf "$tmp_archive"
  trap - EXIT
  echo "✓ Node ${tarball_name} cached"
}

prepare_staging() {
  rm -rf "$OUTPUT_ROOT"
  rm -rf "$STAGING_ROOT"
  mkdir -p "$STAGING_ROOT"

  mkdir -p "$OUTPUT_ROOT"
}

copy_arch_tree() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  rsync -a --delete "$src/" "$dest/"
}

create_universal_binary() {
  local relative_path="$1"
  local arm_file="${STAGING_ROOT}/${ARM_TARBALL}/${relative_path}"
  local x64_file="${STAGING_ROOT}/${X64_TARBALL}/${relative_path}"
  local output_file="${OUTPUT_ROOT}/${relative_path}"

  if [ ! -f "$arm_file" ] || [ ! -f "$x64_file" ]; then
    return
  fi

  mkdir -p "$(dirname "$output_file")"
  lipo -create "$arm_file" "$x64_file" -output "$output_file"
}

walk_and_merge_binaries() {
  local pattern='*'
  (
    cd "${STAGING_ROOT}/${ARM_TARBALL}"
    find . -type f | while read -r relative; do
      if file "${relative}" 2>/dev/null | grep -q "Mach-O"; then
        create_universal_binary "${relative#./}"
      fi
    done
  )
}

finalize_assets() {
  # Copy everything from arm64 tree first (text files, scripts, npm, etc.)
  copy_arch_tree "${STAGING_ROOT}/${ARM_TARBALL}" "$OUTPUT_ROOT"
  # Merge Mach-O binaries/dylibs with lipo (overwrites the copies above).
  walk_and_merge_binaries

  chmod +x "$OUTPUT_ROOT/bin/node"
  echo "node" >"$OUTPUT_ROOT/.arch"
}

print_summary() {
  echo ""
  echo "✅ Universal Node runtime prepared:"
  echo "   - Version: v${NODE_VERSION}"
  echo "   - Output : ${OUTPUT_ROOT}"
  echo "   - Includes npm CLI at ${OUTPUT_ROOT}/lib/node_modules/npm/"
  echo ""
  lipo -info "$OUTPUT_ROOT/bin/node"
}

main() {
  ensure_prerequisites

  download_node "$ARM_TARBALL"
  download_node "$X64_TARBALL"

  prepare_staging

  copy_arch_tree "$CACHE_ROOT/$ARM_TARBALL" "$STAGING_ROOT/$ARM_TARBALL"
  copy_arch_tree "$CACHE_ROOT/$X64_TARBALL" "$STAGING_ROOT/$X64_TARBALL"

  finalize_assets
  print_summary
}

main "$@"
