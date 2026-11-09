#!/usr/bin/env bash
set -euo pipefail

# Orchestrate the production build assets required by the Tauri bundle.
# 1. Builds the Next.js standalone output.
# 2. Prepares the universal Node runtime.
# 3. Copies resources into dist/local-app for the sidecar.
# 4. Rebuilds native modules as universal binaries.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DIST_ROOT="$REPO_ROOT/dist/local-app"
RUNTIME_ROOT="$REPO_ROOT/dist/runtime/node-universal"
STAGING_ROOT="$REPO_ROOT/dist/.staging/production"
SEED_SOURCE="$REPO_ROOT/dist/resources/rah_seed.sqlite"
NEXT_BUILD_DIR="$REPO_ROOT/.next"

resolve_public_env_value() {
  local var_name="$1"
  local fallback="$2"
  local value="${!var_name:-}"

  if [ -z "$value" ] && [ -f "$REPO_ROOT/.env" ]; then
    value="$(grep -E "^${var_name}=" "$REPO_ROOT/.env" | tail -n 1 | cut -d '=' -f2- || true)"
  fi

  if [ -z "$value" ]; then
    value="$fallback"
  fi

  printf '%s' "$value"
}

ensure_prerequisites() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "❌ npm not found. Install Node.js before running this script." >&2
    exit 1
  fi
  if ! command -v rsync >/dev/null 2>&1; then
    echo "❌ rsync is required (brew install rsync)." >&2
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "ℹ️  jq not found; version.json will omit git metadata." >&2
  fi
}

prepare_next_standalone() {
  echo "▶️  Building Next.js standalone output"
  if [ -d "$DIST_ROOT" ]; then
    echo "   • Clearing previous dist at $DIST_ROOT"
    rm -rf "$DIST_ROOT"
  fi
  if [ -f "$REPO_ROOT/tsconfig.tsbuildinfo" ]; then
    echo "   • Removing stale tsconfig build info"
    rm -f "$REPO_ROOT/tsconfig.tsbuildinfo"
  fi
  echo "   • Using node: $(command -v node)"
  echo "   • Node version: $(node -v)"
  echo "   • Node module ABI: $(node -p 'process.versions.modules')"
  local enable_subscriptions backend_url supabase_url supabase_anon app_url
  enable_subscriptions="$(resolve_public_env_value "NEXT_PUBLIC_ENABLE_SUBSCRIPTION_BACKEND" "true")"
  backend_url="$(resolve_public_env_value "NEXT_PUBLIC_BACKEND_URL" "https://api.ra-h.app")"
  supabase_url="$(resolve_public_env_value "NEXT_PUBLIC_SUPABASE_URL" "https://wabhzavwgsizrkjpnryd.supabase.co")"
  supabase_anon="$(resolve_public_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "")"
  app_url="$(resolve_public_env_value "NEXT_PUBLIC_APP_URL" "https://ra-h.app")"

  NEXT_PUBLIC_DEPLOYMENT_MODE=cloud \
  NEXT_PUBLIC_ENABLE_SUBSCRIPTION_BACKEND="${enable_subscriptions}" \
  NEXT_PUBLIC_BACKEND_URL="${backend_url}" \
  NEXT_PUBLIC_SUPABASE_URL="${supabase_url}" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="${supabase_anon}" \
  NEXT_PUBLIC_APP_URL="${app_url}" \
  NODE_ENV=production npm run build

  if [ ! -d "$NEXT_BUILD_DIR/standalone" ]; then
    echo "❌ Next.js standalone output missing at .next/standalone" >&2
    exit 1
  fi
}

prepare_directories() {
  rm -rf "$DIST_ROOT"
  rm -rf "$STAGING_ROOT"

  mkdir -p "$DIST_ROOT/app"
  mkdir -p "$DIST_ROOT/bin"
  mkdir -p "$DIST_ROOT/lib"
  mkdir -p "$DIST_ROOT/vendor/sqlite-extensions"
  mkdir -p "$DIST_ROOT/resources"
  mkdir -p "$DIST_ROOT/logs"

  mkdir -p "$STAGING_ROOT"
}

write_splash_bootstrap() {
  echo "🛰  Writing packaged splash bootstrap with instrumentation"
  local build_id
  build_id="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  cat <<'HTML' >"$DIST_ROOT/index.html"
<!DOCTYPE html>
<html lang="en" data-build="__BUILD_ID__">
  <head>
    <meta charset="utf-8" />
    <title>RA-H</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #09090b;
        color: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
      }
      .status { text-align: center; letter-spacing: 0.02em; max-width: 480px; }
      .status h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      .status p { margin: 0 0 0.75rem; color: #94a3b8; line-height: 1.4; }
      .status pre {
        text-align: left;
        background: rgba(148, 163, 184, 0.08);
        border-radius: 0.75rem;
        padding: 0.75rem;
        font-family: "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 0.75rem;
        max-height: 18rem;
        overflow-y: auto;
        margin: 0;
      }
    </style>
  </head>
  <body data-build="__BUILD_ID__">
    <div class="status">
      <h1 id="status-title">Starting RA-H…</h1>
      <p id="status-message">Bootstrap script pending (<span id="status-build">__BUILD_ID__</span>).</p>
      <pre id="status-log">[0 ms] Splash HTML loaded (build __BUILD_ID__)
</pre>
    </div>
    <script>
      (function () {
        const BUILD_ID = "__BUILD_ID__";
        const start = performance.now();
        const titleEl = document.getElementById('status-title');
        const messageEl = document.getElementById('status-message');
        const logEl = document.getElementById('status-log');
        const state = {
          polls: 0,
          maxLogs: 300
        };

        const sinceStart = () => Math.round(performance.now() - start);
        const appendLog = (label, detail = '') => {
          const stamp = `[${sinceStart()} ms] ${label}`;
          const suffix = detail ? ` :: ${detail}` : '';
          if (logEl.textContent.split('\n').length > state.maxLogs) {
            logEl.textContent = `${logEl.textContent.split('\n').slice(-state.maxLogs / 2).join('\n')}\n`;
          }
          logEl.textContent += `${stamp}${suffix}\n`;
          logEl.scrollTop = logEl.scrollHeight;
          try { console.log(`[splash:${BUILD_ID}] ${label}`, detail); } catch (_) {}
        };

        const updateStatus = (heading, text) => {
          if (heading) titleEl.textContent = heading;
          if (text) messageEl.textContent = text;
        };

        const navigateToPort = (port, source) => {
          if (!port) {
            appendLog('navigateToPort invoked with empty port', source);
            return false;
          }
          const url = `http://127.0.0.1:${port}`;
          updateStatus('Connecting…', `Requesting navigation to ${url}`);
          appendLog('Attempting window.location.replace', `${url} via ${source}`);
          try {
            window.location.replace(url);
            return true;
          } catch (error) {
            appendLog('window.location.replace threw', String(error ?? 'unknown error'));
          }
          try {
            window.location.href = url;
            appendLog('Fallback window.location.href dispatched', url);
            return true;
          } catch (error) {
            appendLog('window.location.href threw', String(error ?? 'unknown error'));
          }
          return false;
        };

        const checkGlobalPort = (source) => {
          const port = window.__RAH_SIDECAR_PORT;
          if (port) {
            appendLog('Detected global port', `${port} via ${source}`);
            navigateToPort(port, source);
            return true;
          }
          return false;
        };

        window.addEventListener('rah:sidecar-port', (event) => {
          appendLog('Event: rah:sidecar-port', JSON.stringify(event?.detail));
          navigateToPort(event?.detail, 'custom-event');
        });

        const tryAttachTauri = () => {
          const api = window.__TAURI__;
          if (!api || !api.tauri || !api.event) {
            appendLog('Tauri APIs unavailable', 'Monitoring native dispatcher');
            return;
          }

          appendLog('__TAURI__ detected', Object.keys(api).join(', '));
          updateStatus('Tauri runtime detected', 'Listening for sidecar events.');

          try {
            api.event.listen('sidecar://port', (event) => {
              appendLog('Event: sidecar://port', JSON.stringify(event?.payload));
              navigateToPort(event?.payload, 'tauri-event');
            }).catch((error) => appendLog('Failed to attach Tauri event listener', String(error ?? 'unknown error')));
          } catch (error) {
            appendLog('Error wiring Tauri listener', String(error ?? 'unknown error'));
          }

          try {
            api.tauri.invoke('get_sidecar_port')
              .then((existingPort) => {
                appendLog('invoke(get_sidecar_port) resolved', JSON.stringify(existingPort));
                if (existingPort) {
                  navigateToPort(existingPort, 'tauri-invoke');
                } else {
                  updateStatus('Awaiting sidecar…', 'Will redirect once port event arrives.');
                }
              })
              .catch((error) => {
                appendLog('invoke(get_sidecar_port) rejected', String(error ?? 'unknown error'));
              });
          } catch (error) {
            appendLog('Error invoking get_sidecar_port', String(error ?? 'unknown error'));
          }
        };

        appendLog('Bootstrap script executing');
        updateStatus('Initialising…', `Build ${BUILD_ID} starting up.`);

        tryAttachTauri();

        const pollForPort = () => {
          if (checkGlobalPort(`poll-${state.polls}`)) {
            return;
          }
          if (state.polls % 10 === 0) {
            appendLog('Polling for native port', `attempt ${state.polls}`);
          }
          state.polls += 1;
          setTimeout(pollForPort, 500);
        };

        if (!checkGlobalPort('initial')) {
          pollForPort();
        }
      })();
    </script>
  </body>
</html>
HTML

  python3 - <<PY
from pathlib import Path
path = Path(r"$DIST_ROOT/index.html")
content = path.read_text()
content = content.replace("__BUILD_ID__", "$build_id")
path.write_text(content)
PY

  # Mirror splash bootstrap at dist/index.html so Tauri can locate web assets
  mkdir -p "$REPO_ROOT/dist"
  cp "$DIST_ROOT/index.html" "$REPO_ROOT/dist/index.html"
}

sync_next_output() {
  echo "📦 Copying Next.js standalone output into dist/local-app"
  rsync -a "$NEXT_BUILD_DIR/standalone/" "$DIST_ROOT/app/"

  if [ -d "$NEXT_BUILD_DIR/static" ]; then
    rsync -a "$NEXT_BUILD_DIR/static/" "$DIST_ROOT/app/.next/static/"
  fi

  # Next.js 15 places the shared vendor chunks outside of the standalone bundle.
  if [ -d "$NEXT_BUILD_DIR/server/vendor-chunks" ]; then
    echo "   • Copying Next.js vendor chunks"
    mkdir -p "$DIST_ROOT/app/.next/server/vendor-chunks"
    rsync -a "$NEXT_BUILD_DIR/server/vendor-chunks/" "$DIST_ROOT/app/.next/server/vendor-chunks/"
  fi

  if [ -d "$REPO_ROOT/public" ]; then
    rsync -a "$REPO_ROOT/public/" "$DIST_ROOT/app/public/"
  fi

  rm -f "$DIST_ROOT/app/src/helpers/"*.json 2>/dev/null || true
}

copy_seed_database() {
  if [ ! -f "$SEED_SOURCE" ]; then
    echo "❌ Seed database missing at $SEED_SOURCE" >&2
    echo "   Run scripts/database/generate-seed.sh to create it." >&2
    exit 1
  fi
  cp "$SEED_SOURCE" "$DIST_ROOT/resources/rah_seed.sqlite"
}

prepare_node_runtime() {
  echo "⚙️  Preparing universal Node runtime"
  "$REPO_ROOT/scripts/build-universal-node.sh"

  if [ ! -x "$RUNTIME_ROOT/bin/node" ]; then
    echo "❌ Universal Node runtime missing at $RUNTIME_ROOT/bin/node" >&2
    exit 1
  fi

  rsync -a "$RUNTIME_ROOT/bin/node" "$DIST_ROOT/bin/node"
  chmod +x "$DIST_ROOT/bin/node"

  # Ensure supporting libraries accompany the binary.
  if [ -d "$RUNTIME_ROOT/lib" ]; then
    rsync -a "$RUNTIME_ROOT/lib/" "$DIST_ROOT/lib/"
  fi
}

sign_node_runtime() {
  local node_bin="$DIST_ROOT/bin/node"
  if [ ! -x "$node_bin" ]; then
    echo "⚠️  Node runtime not found at $node_bin; skipping signing"
    return
  fi

  if ! command -v codesign >/dev/null 2>&1; then
    echo "⚠️  codesign not available; skipping Node runtime signing"
    return
  fi

  local identity="Developer ID Application: Bradley Morris (HTMNQ7JM3H)"
  local entitlements="$REPO_ROOT/apps/mac/src-tauri/entitlements-node.plist"
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$identity"; then
    echo "❌ Signing identity '$identity' not found; cannot produce a release build" >&2
    exit 1
  fi
  echo "🔏 Signing Node runtime with $identity"
  codesign --force --options runtime --timestamp --entitlements "$entitlements" --sign "$identity" "$node_bin"
}

stage_sidecar_launcher_script() {
  local launcher_js="$REPO_ROOT/apps/mac/scripts/sidecar-launcher.js"
  local destination="$DIST_ROOT/bin/sidecar-launcher.js"

  if [ ! -f "$launcher_js" ]; then
    echo "❌ sidecar-launcher.js missing at $launcher_js" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$destination")"
  cp "$launcher_js" "$destination"
}

bundle_mcp_bridge() {
  local server_entry="$REPO_ROOT/apps/mcp-server/server.js"
  local stdio_entry="$REPO_ROOT/apps/mcp-server/stdio-server.js"
  local out_dir="$DIST_ROOT/mcp-server"

  if [ ! -f "$server_entry" ]; then
    echo "❌ MCP server entry not found at $server_entry" >&2
    exit 1
  fi

  mkdir -p "$out_dir"

  echo "🧩 Bundling MCP HTTP bridge"
  npx esbuild "$server_entry" \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=cjs \
    --outfile="$out_dir/server.js"

  if [ -f "$stdio_entry" ]; then
    echo "🧩 Bundling MCP STDIO bridge"
    npx esbuild "$stdio_entry" \
      --bundle \
      --platform=node \
      --target=node20 \
      --format=cjs \
      --banner:js="#!/usr/bin/env node" \
      --outfile="$out_dir/stdio-server.js"
    chmod +x "$out_dir/stdio-server.js"
  fi
}

sign_native_modules() {
  if ! command -v codesign >/dev/null 2>&1; then
    echo "⚠️  codesign not available; skipping native module signing"
    return
  fi

  local identity="Developer ID Application: Bradley Morris (HTMNQ7JM3H)"
  local entitlements="$REPO_ROOT/apps/mac/src-tauri/entitlements-node.plist"
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$identity"; then
    echo "❌ Signing identity '$identity' not found; cannot produce a release build" >&2
    exit 1
  fi
  local modules=(
    # better-sqlite3 v13 (N-API) loads prebuilds/<platform>-<arch>.node; one per macOS arch.
    "$DIST_ROOT/app/node_modules/better-sqlite3/prebuilds/darwin-arm64.node"
    "$DIST_ROOT/app/node_modules/better-sqlite3/prebuilds/darwin-x64.node"
    "$DIST_ROOT/vendor/sqlite-extensions/vec0.dylib"
  )

  local vec_app_path="$DIST_ROOT/app/vendor/sqlite-extensions/vec0.dylib"
  if [ -f "$vec_app_path" ]; then
    modules+=("$vec_app_path")
  fi

  if [ -d "$DIST_ROOT/app/node_modules/@img" ]; then
    while IFS= read -r module_path; do
      modules+=("$module_path")
    done < <(find "$DIST_ROOT/app/node_modules/@img" -type f \( -name "*.node" -o -name "*.dylib" \))
  fi

  for module_path in "${modules[@]}"; do
    if [ -f "$module_path" ]; then
      echo "🔏 Signing native module $(basename "$module_path")"
      chmod +x "$module_path" 2>/dev/null || true
      codesign --force --options runtime --timestamp --entitlements "$entitlements" --sign "$identity" "$module_path"
    else
      echo "⚠️  Native module not found at $module_path; skipping"
    fi
  done
}

prepare_vendor_assets() {
  if [ -f "$REPO_ROOT/vendor/sqlite-extensions/vec0.dylib" ]; then
    cp "$REPO_ROOT/vendor/sqlite-extensions/vec0.dylib" "$DIST_ROOT/vendor/sqlite-extensions/vec0.dylib"
  fi

  if [ -x "$REPO_ROOT/vendor/bin/yt-dlp" ]; then
    mkdir -p "$DIST_ROOT/bin"
    cp "$REPO_ROOT/vendor/bin/yt-dlp" "$DIST_ROOT/bin/yt-dlp"
    chmod +x "$DIST_ROOT/bin/yt-dlp"
  fi
}

sign_sidecar_launcher() {
  local launcher="$REPO_ROOT/apps/mac/scripts/sidecar-launcher"
  if [ ! -x "$launcher" ]; then
    echo "⚠️  Sidecar launcher missing or not executable at $launcher"
    return
  fi

  if ! command -v codesign >/dev/null 2>&1; then
    echo "⚠️  codesign not available; skipping launcher signing"
    return
  fi

  local identity="Developer ID Application: Bradley Morris (HTMNQ7JM3H)"
  local entitlements="$REPO_ROOT/apps/mac/src-tauri/entitlements.plist"
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$identity"; then
    echo "❌ Signing identity '$identity' not found; cannot produce a release build" >&2
    exit 1
  fi
  echo "🔏 Signing sidecar launcher with $identity"
  codesign --force --options runtime --timestamp --entitlements "$entitlements" --sign "$identity" "$launcher"
}

sign_vendor_tools() {
  local identity="Developer ID Application: Bradley Morris (HTMNQ7JM3H)"
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "$identity"; then
    echo "❌ Signing identity '$identity' not found; cannot produce a release build" >&2
    exit 1
  fi

  local yt_dlp="$DIST_ROOT/bin/yt-dlp"
  if [ -x "$yt_dlp" ]; then
    echo "🔏 Signing vendor tool $(basename "$yt_dlp")"
    codesign --force --options runtime --timestamp --sign "$identity" "$yt_dlp"
  fi
}

write_version_metadata() {
  local version
  if [ -n "${VERSION:-}" ]; then
    version="$VERSION"
  elif command -v jq >/dev/null 2>&1; then
    version="$(jq -r '.version' < "$REPO_ROOT/package.json" 2>/dev/null || echo "0.0.0")"
  else
    version="$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
  fi

  local build_date
  build_date="$(date +%Y%m%d)"
  local git_sha
  git_sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  local node_version
  if [ -x "$RUNTIME_ROOT/bin/node" ]; then
    node_version="$("$RUNTIME_ROOT/bin/node" -v 2>/dev/null || echo "vUnknown")"
  else
    # Keep in sync with the NODE_VERSION default in scripts/build-universal-node.sh.
    node_version="v${NODE_VERSION:-24.22.2}"
  fi

  cat >"$DIST_ROOT/version.json" <<EOF
{
  "version": "${version}",
  "build_date": "${build_date}",
  "node_version": "${node_version}",
  "git_commit": "${git_sha}"
}
EOF
}

prepare_env_stub() {
  local enable_subscriptions
  enable_subscriptions="$(resolve_public_env_value "NEXT_PUBLIC_ENABLE_SUBSCRIPTION_BACKEND" "true")"
  local deployment_mode
  deployment_mode="cloud"
  if [ "${NEXT_PUBLIC_DEPLOYMENT_MODE:-}" = "local" ]; then
    echo "⚠️  Forcing NEXT_PUBLIC_DEPLOYMENT_MODE=cloud for production build" >&2
  fi
  local backend_url
  backend_url="$(resolve_public_env_value "NEXT_PUBLIC_BACKEND_URL" "https://api.ra-h.app")"
  local supabase_url
  supabase_url="$(resolve_public_env_value "NEXT_PUBLIC_SUPABASE_URL" "https://wabhzavwgsizrkjpnryd.supabase.co")"
  local supabase_anon
  supabase_anon="$(resolve_public_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "")"

  if [ -z "$supabase_anon" ]; then
    echo "⚠️  NEXT_PUBLIC_SUPABASE_ANON_KEY not set in environment or .env; packaged app may not authenticate." >&2
  fi

  cat >"$DIST_ROOT/.env.production" <<EOF
# Production runtime configuration (public environment values only)
NODE_ENV=production
NEXT_PUBLIC_ENABLE_SUBSCRIPTION_BACKEND=${enable_subscriptions}
NEXT_PUBLIC_BACKEND_URL=${backend_url}
NEXT_PUBLIC_SUPABASE_URL=${supabase_url}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${supabase_anon}
NEXT_PUBLIC_DEPLOYMENT_MODE=${deployment_mode}
EOF
}

build_native_modules() {
  echo "⚙️  Building universal native modules"
  "$REPO_ROOT/scripts/build-native-modules.sh"
}

main() {
  ensure_prerequisites
  prepare_next_standalone
  prepare_directories
  write_splash_bootstrap
  sync_next_output
  copy_seed_database
  prepare_node_runtime
  stage_sidecar_launcher_script
  bundle_mcp_bridge
  sign_node_runtime
  prepare_vendor_assets
  sign_sidecar_launcher
  sign_vendor_tools
  write_version_metadata
  prepare_env_stub
  build_native_modules
  sign_native_modules

  echo ""
  echo "✅ Production payload staged in $DIST_ROOT"
}

main "$@"
