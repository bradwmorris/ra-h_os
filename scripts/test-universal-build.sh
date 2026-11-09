#!/usr/bin/env bash
set -euo pipefail

# Smoke test the universal binaries by loading them under both architectures.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_ROOT="${DIST_ROOT:-$REPO_ROOT/dist/local-app}"
APP_DIR="$DIST_ROOT/app"
NODE_BIN="$DIST_ROOT/bin/node"

assert_exists() {
  local path="$1"
  if [ ! -e "$path" ]; then
    echo "❌ Missing required artifact: $path" >&2
    exit 1
  fi
}

check_universal() {
  local path="$1"
  if ! file -b "$path" | grep -q "arm64"; then
    echo "❌ $path is missing arm64 slice" >&2
    exit 1
  fi
  if ! file -b "$path" | grep -q "x86_64"; then
    echo "❌ $path is missing x86_64 slice" >&2
    exit 1
  fi
}

run_dual_arch_node() {
  local arch="$1"
  local script="$2"

  if [ "$arch" = "x86_64" ]; then
    arch -x86_64 "$NODE_BIN" -e "$script"
  else
    arch -arm64 "$NODE_BIN" -e "$script"
  fi
}

# `file -b` omits the filename: darwin-arm64.node would otherwise always match "arm64".
check_single_arch() {
  local path="$1"
  local expected="$2"
  if ! file -b "$path" | grep -q "$expected"; then
    echo "❌ $path is not a ${expected} binary" >&2
    exit 1
  fi
}

main() {
  # better-sqlite3 v13 ships one N-API prebuild per arch instead of a lipo'd universal binary.
  local bs3_prebuilds="$APP_DIR/node_modules/better-sqlite3/prebuilds"

  assert_exists "$NODE_BIN"
  assert_exists "$bs3_prebuilds/darwin-arm64.node"
  assert_exists "$bs3_prebuilds/darwin-x64.node"
  assert_exists "$DIST_ROOT/vendor/sqlite-extensions/vec0.dylib"

  echo "ℹ️  Verifying binary architectures"
  check_universal "$NODE_BIN"
  check_single_arch "$bs3_prebuilds/darwin-arm64.node" "arm64"
  check_single_arch "$bs3_prebuilds/darwin-x64.node" "x86_64"
  check_universal "$DIST_ROOT/vendor/sqlite-extensions/vec0.dylib"

  echo "ℹ️  Running runtime smoke tests"
  run_dual_arch_node arm64 "console.log('arm64 runtime ok')"
  run_dual_arch_node x86_64 "console.log('x86 runtime ok')"

  # The native addon loads lazily on the first Database construction, so open an
  # in-memory database and run a query; a bare require() would not load it.
  local bs3_smoke="const D=require('./node_modules/better-sqlite3'); const r=new D(':memory:').prepare('select 1 as ok').get(); if (r.ok!==1) throw new Error('query failed'); console.log('better-sqlite3 ' + process.arch + ' ok')"
  (
    cd "$APP_DIR"
    run_dual_arch_node arm64 "$bs3_smoke"
    run_dual_arch_node x86_64 "$bs3_smoke"
  )

  echo "✅ Universal build smoke test passed"
}

main "$@"
