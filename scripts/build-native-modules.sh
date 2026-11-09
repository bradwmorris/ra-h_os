#!/usr/bin/env bash
set -euo pipefail

# Build universal native dependencies (better-sqlite3 + sqlite-vec) for the packaged bundle.
# Relies on the universal Node runtime prepared in dist/runtime/node-universal.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PATH="$REPO_ROOT/scripts:$PATH"

DIST_ROOT="${DIST_ROOT:-$REPO_ROOT/dist/local-app}"
APP_DIR="${APP_DIR:-$DIST_ROOT/app}"
NODE_RUNTIME_DIR="${NODE_RUNTIME_DIR:-$REPO_ROOT/dist/runtime/node-universal}"
NODE_BIN="$NODE_RUNTIME_DIR/bin/node"
NPM_CLI="$NODE_RUNTIME_DIR/lib/node_modules/npm/bin/npm-cli.js"

SQLITE_VEC_REPO="${SQLITE_VEC_REPO:-https://github.com/asg017/sqlite-vec.git}"
SQLITE_VEC_REF="${SQLITE_VEC_REF:-main}"
SQLITE_VEC_SOURCE_DIR="${SQLITE_VEC_SOURCE_DIR:-$REPO_ROOT/dist/.deps/sqlite-vec-src}"
SQLITE_VEC_OUTPUT="${SQLITE_VEC_OUTPUT:-$DIST_ROOT/vendor/sqlite-extensions/vec0.dylib}"
SQLITE_VEC_VENDOR_COPY="${SQLITE_VEC_VENDOR_COPY:-$REPO_ROOT/vendor/sqlite-extensions/vec0.dylib}"

TMP_DIR="$(mktemp -d -t rah-native-XXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ensure_prerequisites() {
  if [ ! -x "$NODE_BIN" ]; then
    echo "❌ Universal Node runtime missing at $NODE_BIN" >&2
    echo "   Run scripts/build-universal-node.sh first." >&2
    exit 1
  fi

  if [ ! -d "$APP_DIR" ]; then
    echo "❌ Next.js standalone output missing at $APP_DIR" >&2
    echo "   Ensure scripts/build-production.sh has copied the app bundle." >&2
    exit 1
  fi

  if [ ! -d "$APP_DIR/node_modules/better-sqlite3" ]; then
    echo "❌ better-sqlite3 node module missing from $APP_DIR/node_modules." >&2
    echo "   Did you run npm run build before invoking this script?" >&2
    exit 1
  fi

  if ! command -v arch >/dev/null 2>&1; then
    echo "❌ arch command not found. Install Xcode command line tools." >&2
    exit 1
  fi

  if arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
    :
  else
    echo "❌ Rosetta is required to build x86_64 binaries. Install with 'softwareupdate --install-rosetta'." >&2
    exit 1
  fi

  if ! command -v lipo >/dev/null 2>&1; then
    echo "❌ lipo not found. Install Xcode command line tools (xcode-select --install)." >&2
    exit 1
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "❌ git not found. Install git to fetch sqlite-vec source." >&2
    exit 1
  fi
}

ensure_sqlite_vec_source() {
  if [ -d "$SQLITE_VEC_SOURCE_DIR/.git" ]; then
    return
  fi

  echo "⬇️  Cloning sqlite-vec sources into $SQLITE_VEC_SOURCE_DIR"
  mkdir -p "$(dirname "$SQLITE_VEC_SOURCE_DIR")"
  git clone --depth 1 --branch "$SQLITE_VEC_REF" "$SQLITE_VEC_REPO" "$SQLITE_VEC_SOURCE_DIR"
}

refresh_better_sqlite3_sources() {
  local root_module="$REPO_ROOT/node_modules/better-sqlite3"
  local target_module="$APP_DIR/node_modules/better-sqlite3"

  if [ ! -d "$root_module" ]; then
    echo "❌ Root better-sqlite3 module missing at $root_module" >&2
    echo "   Run npm install in the repo root before packaging." >&2
    exit 1
  fi

  rm -rf "$target_module"
  mkdir -p "$target_module"
  rsync -a "$root_module/" "$target_module/"
}

arch_prefix() {
  local arch="$1"
  if [ "$arch" = "x86_64" ]; then
    echo "arch -x86_64"
  else
    echo "arch -arm64"
  fi
}

codesign_if_available() {
  local target="$1"
  if ! command -v codesign >/dev/null 2>&1; then
    return
  fi

  local identity="${CODESIGN_IDENTITY:--}"
  local extra_opts=()
  if [ "${CODESIGN_HARDENED_RUNTIME:-1}" = "1" ]; then
    extra_opts=(--options runtime)
  fi

  local codesign_cmd=(codesign --force --timestamp --sign "$identity" "${extra_opts[@]}" "$target")

  "${codesign_cmd[@]}" >/dev/null 2>&1 || \
    codesign --force --timestamp --sign - "${extra_opts[@]}" "$target" >/dev/null 2>&1 || true
}

# better-sqlite3 v13 is an N-API addon that ships per-platform prebuilds and loads
# prebuilds/<platform>-<arch>.node at runtime (lib/binding.js), ahead of build/Release.
# N-API binaries are Node-version independent, so no per-arch rebuild or lipo merge is
# needed: the universal Node runtime picks darwin-arm64 or darwin-x64 by process.arch.
# Keep only the two macOS prebuilds, verify their architectures, and sign them.
stage_better_sqlite3_prebuilds() {
  local module_dir="$APP_DIR/node_modules/better-sqlite3"
  local prebuild_dir="$module_dir/prebuilds"
  local pair arch_name expected file_path

  for pair in "darwin-arm64:arm64" "darwin-x64:x86_64"; do
    arch_name="${pair%%:*}"
    expected="${pair##*:}"
    file_path="$prebuild_dir/${arch_name}.node"
    if [ ! -f "$file_path" ]; then
      echo "❌ better-sqlite3 prebuild missing: $file_path" >&2
      echo "   better-sqlite3 v13+ ships macOS prebuilds; check the installed version." >&2
      exit 1
    fi
    if ! lipo -archs "$file_path" | grep -qw "$expected"; then
      echo "❌ $file_path is not a ${expected} binary (lipo reports: $(lipo -archs "$file_path"))" >&2
      exit 1
    fi
  done

  # Drop non-macOS prebuilds and any stale node-gyp output so only the signed
  # darwin binaries ship and the loader cannot fall back to an unsigned build.
  find "$prebuild_dir" -type f -name '*.node' ! -name 'darwin-arm64.node' ! -name 'darwin-x64.node' -delete
  rm -rf "$module_dir/build"

  codesign_if_available "$prebuild_dir/darwin-arm64.node"
  codesign_if_available "$prebuild_dir/darwin-x64.node"
  echo "✓ better-sqlite3 macOS prebuilds staged in $prebuild_dir"
}

build_sqlite_vec_for_arch() {
  local arch="$1"
  local output="$TMP_DIR/vec0.${arch}.dylib"

  echo "⚙️  Building sqlite-vec (vec0) for ${arch}"

  local include_dir="${SQLITE3_INCLUDE_DIR:-}"
  local lib_dir="${SQLITE3_LIB_DIR:-}"

  if { [ -z "$include_dir" ] || [ -z "$lib_dir" ]; } && command -v brew >/dev/null 2>&1; then
    local brew_prefix
    brew_prefix="$(brew --prefix sqlite 2>/dev/null || true)"
    if [ -n "$brew_prefix" ]; then
      if [ -z "$include_dir" ] && [ -d "$brew_prefix/include" ]; then
        include_dir="$brew_prefix/include"
      fi
      if [ -z "$lib_dir" ] && [ -d "$brew_prefix/lib" ]; then
        lib_dir="$brew_prefix/lib"
      fi
    fi
  fi

  local cflags="-O3 -fPIC -arch $arch -undefined dynamic_lookup"
  if [ -n "$include_dir" ]; then
    cflags="$cflags -I${include_dir}"
  fi
  if [ -n "$lib_dir" ]; then
    cflags="$cflags -L${lib_dir}"
  fi

  local arch_cmd
  arch_cmd=($(arch_prefix "$arch"))

  local -a env_vars=(
    "CC=clang"
    "CFLAGS=$cflags"
  )

  if [ -n "$include_dir" ] || [ -n "$lib_dir" ]; then
    env_vars+=("USE_BREW_SQLITE=1")
    if [ -n "$include_dir" ]; then
      env_vars+=("SQLITE_INCLUDE_PATH=-I${include_dir}")
    fi
    if [ -n "$lib_dir" ]; then
      env_vars+=("SQLITE_LIB_PATH=-L${lib_dir}")
    fi
  fi

  (
    cd "$SQLITE_VEC_SOURCE_DIR"
    make clean >/dev/null 2>&1 || true
    "${arch_cmd[@]}" env "${env_vars[@]}" make loadable
  )

  local built_path="$SQLITE_VEC_SOURCE_DIR/dist/vec0.dylib"

  if [ ! -f "$built_path" ]; then
    echo "❌ sqlite-vec build failed for ${arch}. Inspect make output above." >&2
    exit 1
  fi

  mv "$built_path" "$output"
}

combine_sqlite_vec() {
  mkdir -p "$(dirname "$SQLITE_VEC_OUTPUT")"
  mkdir -p "$(dirname "$SQLITE_VEC_VENDOR_COPY")"

  lipo -create \
    "$TMP_DIR/vec0.arm64.dylib" \
    "$TMP_DIR/vec0.x86_64.dylib" \
    -output "$SQLITE_VEC_OUTPUT"

  cp "$SQLITE_VEC_OUTPUT" "$SQLITE_VEC_VENDOR_COPY"

  codesign_if_available "$SQLITE_VEC_OUTPUT"
  codesign_if_available "$SQLITE_VEC_VENDOR_COPY"

  echo "✓ sqlite-vec universal dylib ready at $SQLITE_VEC_OUTPUT"
}

codesign_additional_binaries() {
  local -a extras=(
    "$DIST_ROOT/bin/yt-dlp"
    "$APP_DIR/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node"
    "$APP_DIR/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64.node"
  )

  for target in "${extras[@]}"; do
    if [ -e "$target" ]; then
      codesign_if_available "$target"
    fi
  done

  local glob
  for glob in \
    "$APP_DIR/node_modules/@img/sharp-libvips-darwin-arm64/lib/"* \
    "$APP_DIR/node_modules/@img/sharp-libvips-darwin-x64/lib/"*; do
    if [ -e "$glob" ]; then
      codesign_if_available "$glob"
    fi
  done
}

main() {
  ensure_prerequisites
  ensure_sqlite_vec_source
  refresh_better_sqlite3_sources

  stage_better_sqlite3_prebuilds

  build_sqlite_vec_for_arch arm64
  build_sqlite_vec_for_arch x86_64
  combine_sqlite_vec
  codesign_additional_binaries
}

main "$@"
