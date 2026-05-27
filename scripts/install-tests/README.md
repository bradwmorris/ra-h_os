# Installer Tests

Disposable, host-isolated test harnesses for `scripts/install.sh` and `scripts/install.ps1`.

Nothing here modifies your host — Docker containers run with `--rm` and Windows Sandbox is destroyed on close. Repo mounts are read-only.

## Quick copy

### Run the full suite

Linux (from inside WSL Ubuntu, docker running) and Windows (from the host, Windows Sandbox enabled) are independent and can run in parallel. Logs for both land under `scripts/install-tests/logs/<timestamp>-{linux,windows}-*/` (gitignored).

```bash
# ── Linux (WSL) ──────────────────────────────────────────────────────────────
cd /mnt/f/Development/ra-h_os
sudo service docker start                  # if not already running

# Light: edge cases + openai across all 4 distros + llama-cpp mock
./scripts/install-tests/linux-edge-cases.sh
MODE=local ./scripts/install-tests/linux-docker-matrix.sh
MODE=local PROFILE=llama-cpp ./scripts/install-tests/linux-docker-matrix.sh

# Heavy (real models, opt-in): qwen-local + real llama-cpp (1 distro each by default)
ALLOW_HEAVY=1 MODE=local PROFILE=qwen-local ./scripts/install-tests/linux-docker-matrix.sh
ALLOW_HEAVY=1 MODE=local PROFILE=llama-cpp ./scripts/install-tests/linux-docker-matrix.sh
# (add DISTROS="ubuntu:24.04|apt ubuntu:22.04|apt debian:12|apt fedora:40|dnf" to cover all 4)
```

```powershell
# ── Windows (host, run each after closing the previous Sandbox) ───────────────
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile openai
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile llama-cpp            # mock
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile llama-cpp -Heavy     # real llama-server
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile qwen-local           # real Ollama + models
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile openai -Winget       # install.ps1's winget path
```

> **Note:** `-Winget qwen-local` verifies winget's *Ollama install* but the Ollama daemon does not start in the sandbox's non-interactive session (the winget desktop app expects an interactive login) — see [What these tests do NOT cover](#what-these-tests-do-not-cover). The winget *Node* path and the portable-Ollama daemon path are both verified.

### openai profile (fast — no models pulled)

```bash
# Linux — smoke test against your local working copy (single distro, ~3 min)
# Run from inside WSL Ubuntu so it talks to the WSL docker daemon
sudo service docker start   # if not already running
cd /mnt/f/Development/ra-h_os
DISTROS="ubuntu:24.04|apt" MODE=local ./scripts/install-tests/linux-docker-matrix.sh

# Linux — full 4-distro matrix against your local working copy (~10–15 min)
MODE=local ./scripts/install-tests/linux-docker-matrix.sh

# Linux — once the branch is on GitHub, test the actual one-liner URL
REF=feature/one-line-install-scripts ./scripts/install-tests/linux-docker-matrix.sh

# Linux — edge-case scenarios (~15 min total): no API key, non-git dir,
# re-run uses git pull, pre-release Node version tag regression guard
./scripts/install-tests/linux-edge-cases.sh
```

```powershell
# Windows — test the public install.ps1 one-liner in a disposable VM
# (run from Windows, not WSL; requires Windows Sandbox enabled + reboot done)
explorer.exe scripts\install-tests\windows-sandbox-remote.wsb

# Windows — test your local install.ps1 working copy
.\scripts\install-tests\Run-LocalSandbox.ps1

# Windows — exercise install.ps1's real winget paths (installs winget, lets the
# installer winget-install Node itself instead of using the portable bootstrap)
.\scripts\install-tests\Run-LocalSandbox.ps1 -Winget
```

### qwen-local profile (heavy — real Ollama + ~3 GB of models)

Pulls `qwen3:4b` (~2.6 GB) and `qwen3-embedding:0.6b` (~600 MB). On Linux it is gated behind `ALLOW_HEAVY=1` and defaults to a single distro; the Windows sandbox always runs it for real (it downloads Ollama, ~2 GB, then pulls the models). Budget plenty of time, bandwidth, and disk.

```bash
# Linux — one distro (the default when qwen-local is selected)
ALLOW_HEAVY=1 PROFILE=qwen-local MODE=local ./scripts/install-tests/linux-docker-matrix.sh

# Linux — across all four distros (pulls models 4 times, ~45–60 min)
ALLOW_HEAVY=1 PROFILE=qwen-local MODE=local \
  DISTROS="ubuntu:24.04|apt ubuntu:22.04|apt debian:12|apt fedora:40|dnf" \
  ./scripts/install-tests/linux-docker-matrix.sh
```

```powershell
# Windows — local working copy with qwen-local
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile qwen-local

# Windows — public install.ps1 with qwen-local in a disposable VM
explorer.exe scripts\install-tests\windows-sandbox-remote-qwen.wsb
```

### llama-cpp profile (mock by default; real with a flag)

The installer only checks that an OpenAI-compatible server answers on the LLM and
embedding ports (8080/8081). By default the harness starts a tiny **mock** so the
check passes instantly (CI-friendly). Add the heavy flag to provision a **real**
`llama-server` + small GGUF models instead (downloads a server + ~0.5 GB of models).

```bash
# Linux — mock servers (fast, CI-friendly)
PROFILE=llama-cpp MODE=local ./scripts/install-tests/linux-docker-matrix.sh

# Linux — REAL llama-server + models (full system)
ALLOW_HEAVY=1 PROFILE=llama-cpp MODE=local ./scripts/install-tests/linux-docker-matrix.sh

# The llama-cpp edge case in linux-edge-cases.sh also exercises the mock on custom ports
./scripts/install-tests/linux-edge-cases.sh
```

```powershell
# Windows — mock servers (fast)
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile llama-cpp

# Windows — REAL llama-server + models (full system)
.\scripts\install-tests\Run-LocalSandbox.ps1 -AiProfile llama-cpp -Heavy
```

Real-llama-cpp model URLs are overridable via `CHAT_GGUF_URL` / `EMBED_GGUF_URL`
(and `LLAMACPP_ASSET_RE` for the release asset) if an upstream URL changes.

See sections below for prerequisites and full option reference.

## Cleanup / disk usage

Models and installed packages **are cleaned up automatically** during a test run — both platforms are designed to be disposable:

- **Docker containers** run with `--rm`, so the container's writable layer (where ollama puts its ~3 GB of models, plus npm modules, plus everything else) is deleted on exit. Nothing about a test run persists on your host filesystem.
- **Windows Sandbox** destroys the entire VM when the window closes. The repo mount is read-only, so the host is never touched either way.

What *does* persist between runs and accumulate over time:

- **Base distro images** — `ubuntu:24.04`, `ubuntu:22.04`, `debian:12`, `fedora:40` (~500 MB total) cached so subsequent matrix runs don't re-pull.
- **`rah-test:*` images** — the three pre-seeded Tier 2 images for edge-case scenarios (~1–2 GB total).
- **Log directories** — `scripts/install-tests/logs/<timestamp>-{windows,linux}-*/` in the repo (gitignored), plus any legacy `/tmp/rah-install-tests/` and `/tmp/rah-*.log`.

### Cleanup script

```bash
# Show what would be removed, do nothing
./scripts/install-tests/cleanup.sh --dry-run

# Remove all test images + logs, prompts for confirmation
./scripts/install-tests/cleanup.sh

# Same, skip the prompt
./scripts/install-tests/cleanup.sh --yes

# Also prune Docker's shared build cache (affects ALL your docker work)
./scripts/install-tests/cleanup.sh --with-build-cache --yes
```

The script removes only test-scoped artifacts by default. Build cache pruning is opt-in because that cache is shared across every docker build on your host, not just these tests.

If you'd rather run the underlying commands by hand:

```bash
docker rmi rah-test:nvm-no-node rah-test:old-node rah-test:prerelease-node
docker rmi ubuntu:24.04 ubuntu:22.04 debian:12 fedora:40
rm -rf scripts/install-tests/logs/* /tmp/rah-install-tests /tmp/rah-*.log
# Or, for the nuclear option (touches everything Docker has cached):
docker system prune -a
```

## Linux / macOS (Docker)

Runs the installer in a matrix of clean base images (`ubuntu:24.04`, `ubuntu:22.04`, `debian:12`, `fedora:40`).

### Prerequisite

A reachable Docker daemon. On Windows this typically means starting Docker inside your WSL distro before running the script:

```bash
# Inside WSL Ubuntu (one-shot, daemon dies on WSL shutdown)
sudo service docker start
```

Run the script from inside WSL so it talks to the WSL-side daemon directly.

### Quick validation (single distro)

Fast smoke test before fanning out to the full matrix:

```bash
DISTROS="ubuntu:24.04|apt" MODE=local ./scripts/install-tests/linux-docker-matrix.sh
```

### Full matrix

```bash
# Test the version published on main (mirrors the public one-liner)
./scripts/install-tests/linux-docker-matrix.sh

# Test a different ref on GitHub (use this once your branch is pushed)
REF=feature/one-line-install-scripts ./scripts/install-tests/linux-docker-matrix.sh

# Test your local working copy (mounts the repo read-only) — works pre-merge
MODE=local ./scripts/install-tests/linux-docker-matrix.sh

# Switch profile (default: openai)
PROFILE=qwen-local ./scripts/install-tests/linux-docker-matrix.sh

# Custom distro list (space-separated "image|pm" entries; pm is apt or dnf)
DISTROS="debian:12|apt fedora:40|dnf" MODE=local ./scripts/install-tests/linux-docker-matrix.sh
```

Prints a PASS/FAIL summary at the end and exits non-zero if any distro failed.

Each distro's full output is also streamed live AND written to a per-run log directory in the repo at `scripts/install-tests/logs/<YYYYMMDD-HHMMSS>-linux-<mode>-<profile>/<image>.log` (gitignored, alongside the Windows sandbox logs). The summary lists the log path next to each result so failures are one tail away. Override with `LOG_DIR=/path/to/dir` if you want a different location.

**Note:** in `MODE=local` the installer still `git clone`s `main` from GitHub — only `install.sh` itself comes from your working copy. Push your branch and use `REF=<branch>` if you need the clone to pick up your changes too.

### Edge-case scenarios

`linux-edge-cases.sh` runs seven scenarios that the distro matrix doesn't cover. Each scenario runs in its own `--rm` container against the local repo.

**Tier 1 — default-image scenarios** (run against `$IMAGE`, default `ubuntu:24.04`):

| Scenario | What it asserts |
|---|---|
| `noenv-warns` | `install.sh --yes` with no `OPENAI_API_KEY` env var → exit 0 and "Add it later in Settings" warning |
| `non-git-dir-errors` | Existing `ra-h_os/` dir that isn't a git repo → exit 1 and "is not a git repository" error |
| `rerun-uses-pull` | Running the installer twice → second run logs "pulling latest changes" instead of re-cloning |

**Tier 2 — pre-seeded-image scenarios** (custom Docker images built from `fixtures/Dockerfile.*`):

| Scenario | Image | What it asserts |
|---|---|---|
| `nvm-present-no-node` | `rah-test:nvm-no-node` | nvm installed but no Node → installer's "nvm detected" path runs silently |
| `old-node-auto-upgrade` | `rah-test:old-node` | Node 18 pre-installed → installer's "too old — upgrading to v20 via nvm" recovery path runs and completes |
| `prerelease-node-tag-no-crash` | `rah-test:prerelease-node` | Node 20 + version shim returning `20.18.1-rc.1` → installer parses suffix correctly without crashing bash arithmetic under `set -e` (regression guard for L-PASS5-1) |
| `llama-cpp-with-mock-servers` | `rah-test:llama-cpp-mock` | `--profile llama-cpp` with `--llm-port 9090 --embedding-port 9091` and a Python mock returning 200 on `/v1/models` → reachability check uses custom ports and installer exits 0. **Limitation:** doesn't assert `.env.local` contains the custom URLs because `bootstrap-local.mjs` ignores those env vars today — tracked at [#16](https://github.com/bradwmorris/ra-h_os/issues/16) |

The Tier 2 images are built once on first invocation (~2 min total — apt + nvm + Node install per image) and cached by Docker for subsequent runs. To force a rebuild after editing a Dockerfile:

```bash
docker rmi rah-test:nvm-no-node rah-test:old-node rah-test:prerelease-node rah-test:llama-cpp-mock
```

Override the Tier 1 base image with `IMAGE=debian:12` etc. (apt-based only — the bootstrap installs `curl git ca-certificates`). Tier 2 images are pinned to `ubuntu:24.04` in their Dockerfiles.

## Windows (Windows Sandbox)

Requires Windows 10/11 Pro or Enterprise with the Sandbox feature enabled (one-time, admin PowerShell on host):

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClientVM" -All
```
Reboot afterward.

`Run-LocalSandbox.ps1` mirrors the Linux harness's `MODE` switch via a `-Mode` parameter (`local` default, or `remote`). A vanilla Windows Sandbox ships without git **or** winget, so the launcher mounts the repo and runs `sandbox-bootstrap.ps1`, which downloads portable git (MinGit) and a Node.js zip into the throwaway session before handing off to the installer. The full run is teed to a read-write log folder on the host (`scripts\install-tests\logs\<timestamp>-<mode>-<profile>\install.log`) so results survive the sandbox closing.

```powershell
# Local mode (default) — tests your working copy / PR branch
.\Run-LocalSandbox.ps1                              # openai profile
.\Run-LocalSandbox.ps1 -AiProfile qwen-local

# Remote mode — tests the published installer from a GitHub ref
.\Run-LocalSandbox.ps1 -Mode remote                 # install.ps1 from main
.\Run-LocalSandbox.ps1 -Mode remote -Ref my-branch  # from a pushed branch
```

- **`-Mode local`** runs the **mounted** `install.ps1` and *pre-clones your branch from the mount* (`git clone` of the read-only working-copy HEAD into the install dir), so `install.ps1` finds an existing repo and `git pull`s from the mount instead of cloning `main`. This exercises the whole PR — branch installer **and** branch app code. Unlike Linux local mode, the clone is **not** from GitHub.
- **`-Mode remote`** fetches `install.ps1` from `https://raw.githubusercontent.com/.../<Ref>/scripts/install.ps1` and runs it; the installer then clones the published repo (`main`). `-Ref` defaults to `main`.
- **`-Winget`** installs winget (App Installer) into the sandbox and **skips** the portable Node/Ollama bootstrap, so `install.ps1`'s own winget paths run (`winget install OpenJS.NodeJS.LTS`, `winget install Ollama.Ollama`). Without it, the portable provisioning means the installer finds those deps already present and never calls winget. git is still bootstrapped either way (the installer requires it but never installs it). Use this to verify the winget branches that the default mock-free bootstrap bypasses.

For a zero-setup remote smoke test with no repo mount, the static `windows-sandbox-remote.wsb` / `windows-sandbox-remote-qwen.wsb` still work — double-click them to boot a VM that runs `irm .../install.ps1 | iex` directly.

Close the Sandbox window when done — everything inside is wiped; the host log folder remains.

## What gets tested

The default `openai` profile is the cheap smoke test — it doesn't need network services or models. It verifies:

- Node detection / install (nvm on Linux; winget on Windows — the Sandbox harness pre-provisions a portable Node by default, so the winget path isn't exercised unless you pass `Run-LocalSandbox.ps1 -Winget`, which installs winget and lets `install.ps1` use it)
- Git clone
- `npm install` + `npm run setup:local`
- `.env.local` creation and permissions hardening
- sqlite-vec extension detection (warns but doesn't fail if missing)

`qwen-local` additionally installs Ollama, starts the daemon, and pulls multi-GB models (gated behind `ALLOW_HEAVY=1` on Linux). `llama-cpp` runs against a mock `/v1/models` server by default, or a real `llama-server` + GGUF models with the heavy flag.

### Profile × platform coverage

| Profile | Linux (Docker matrix + edge cases) | Windows (Sandbox) |
|---|---|---|
| **openai** | ✅ 4 distros + edge cases | ✅ local + remote |
| **qwen-local** | ✅ real, `ALLOW_HEAVY=1` (1 distro default) | ✅ real (always) |
| **llama-cpp** | ✅ mock (default) · ✅ real, `ALLOW_HEAVY=1` | ✅ mock (default) · ✅ real, `-Heavy` |

Not covered: **macOS** (Docker runs Linux containers, so the Darwin branches of `install.sh` — `brew install ollama`, `.dylib` vec ext, `brew services` — need a real Mac), and **app boot** (`npm run dev` is never started).

## What these tests do NOT cover

Be honest about the limits before relying on a green result:

- **macOS-native paths.** The README header says "Linux / macOS" because Docker can be run from a Mac host, but Docker on macOS runs Linux containers — the Darwin-specific branches of `install.sh` (`brew install ollama`, the `.dylib` sqlite-vec extension, `brew services`) are never executed. Test those on a real Mac.
- **The cloned repo contents (Linux + Windows remote mode).** In Linux local/remote and Windows `-Mode remote`, the installer always `git clone`s from `main`; `REF`/`-Ref` only swaps where the *installer script itself* comes from. Changes to `setup-local.mjs`, `package.json`, or anything else on a feature branch won't be exercised. **Exception:** Windows `-Mode local` pre-clones your branch from the read-only mount, so it *does* test branch app code.
- **`llama-cpp` against a *real* model's quality.** The profile is tested two ways — a mock `/v1/models` server (default) and a real `llama-server` + small GGUFs (`ALLOW_HEAVY=1` / `-Heavy`). Both only verify the installer's port-reachability check and that setup completes; neither asserts inference quality, and the real path depends on external model URLs that can change (override with `CHAT_GGUF_URL` / `EMBED_GGUF_URL`).
- **winget Ollama daemon in the sandbox.** `Run-LocalSandbox.ps1 -Winget -AiProfile qwen-local` verifies winget *installs* Ollama, but the daemon won't start in the Sandbox's non-interactive `LogonCommand` session (the winget desktop app starts its server via the tray app on interactive login). This is a sandbox limitation, not an `install.ps1` defect — a real interactive Windows user's winget-installed Ollama auto-starts and `install.ps1` detects it. The daemon path itself is verified via the portable-Ollama (`-AiProfile qwen-local`) run and on Linux.
- **App boot.** `npm run dev` is never started. "Installation complete!" means the installer exited 0, not that the Next.js server actually starts, the database opens, or the UI loads.
- **API key validity.** The Linux tests pass `OPENAI_API_KEY=sk-test-placeholder` so the installer writes *something* to `.env.local`. It is never validated against OpenAI's API.
- **MCP setup.** The `npx -y ra-h-mcp-server@latest setup` step shown at the end of the installer is informational only — it isn't run.
- **Network edge cases.** Containers and Sandbox share the host's network. Behavior behind corporate proxies, captive portals, or with restrictive firewalls is not exercised.

## Interpreting results

A `PASS` line means: the installer script ran to completion, exited 0, and printed `Installation complete!`. That's it.

It does **not** prove the app works end-to-end. To verify the install actually produced a runnable app, drop `--rm` from a container (or open a shell into the Sandbox) and run `npm run dev` manually, then hit `http://localhost:3000`. Adding an automated post-install smoke that boots Next.js and curls the homepage would close this gap; it's not in scope today.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Cannot connect to the Docker daemon at unix:///var/run/docker.sock` | Daemon not running. Inside WSL: `sudo service docker start`. |
| `permission denied: ./linux-docker-matrix.sh` | Lost executable bit (common after Windows checkout). Fix: `chmod +x scripts/install-tests/linux-docker-matrix.sh`. |
| `docker: command not found` on Windows | You're in PowerShell on the host — switch to WSL Ubuntu, or install Docker Desktop. |
| `/mnt/f/Development/ra-h_os: No such file or directory` inside WSL | The drive isn't mounted in this WSL instance. Check `/etc/wsl.conf` automount settings. |
| Windows Sandbox menu entry missing | Feature not enabled, or reboot wasn't done. Re-run the `Enable-WindowsOptionalFeature` command and reboot. |
| `WindowsSandbox.exe` exists but `.wsb` won't launch | Try double-clicking from File Explorer instead of `explorer.exe <path>` — file association may not be registered for elevated shells. |
| Sandbox crashes on launch / black-screens / `Hyper-V-Worker Event 33101` vPCI protocol version mismatch | Disable vGPU sharing — see [Windows Sandbox won't start](#windows-sandbox-wont-start) below. |
| Sandbox fails to start with a compute/network/disk service error (e.g. `Error 0x80070424`, "service does not exist") | The virtualization services aren't running. Set them to Automatic — see [Windows Sandbox won't start](#windows-sandbox-wont-start) below. |
| Model pull stalls at 0% or 1% on the qwen-local profile | Ollama registry slowness or local bandwidth. Retry; or pre-pull on the host and bind-mount `~/.ollama` (advanced). |
| `ERROR: This version requires zstd` during ollama install | Should be handled by `install.sh`'s zstd preflight. If you see it, the installer is out of date — pull `main`. |
| Per-distro log path scrolls off screen | All logs land under `scripts/install-tests/logs/<timestamp>-linux-*/`; the dir is printed at the top of every run. |

### Windows Sandbox won't start

On some Windows 11 builds the Sandbox crashes on launch, black-screens, or logs a
`Hyper-V-Worker Event 33101` vPCI protocol version mismatch. Two host-side fixes,
applied together, resolve it:

**1. Disable vGPU sharing.** The vGPU path is the usual culprit behind the vPCI
mismatch; the harness doesn't need a GPU.

- `Win+R` → `gpedit.msc`
- Computer Configuration → Administrative Templates → Windows Components → Windows Sandbox
- Set **"Allow vGPU sharing for Windows Sandbox"** to **Disabled**

  (No Group Policy Editor on Home editions — set the registry value instead, then reboot:
  `reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Sandbox" /v AllowVGPU /t REG_DWORD /d 0 /f`)

**2. Ensure the virtualization services start automatically.** If these are
disabled or set to *Automatic (Delayed Start)*, the Sandbox can fail to start
before they are ready. In `services.msc`, set each of these to **Automatic**
(not delayed), then reboot:

- Hyper-V Host Compute Service
- Container Manager Service
- Network Virtualization Service
- Virtual Disk

Equivalent from an **admin** PowerShell (matches by display name so it works
regardless of the internal service key):

```powershell
'Hyper-V Host Compute Service','Container Manager Service','Network Virtualization Service','Virtual Disk' |
  ForEach-Object {
    $svc = Get-Service -DisplayName $_ -ErrorAction SilentlyContinue
    if ($svc) { Set-Service -Name $svc.Name -StartupType Automatic; Write-Host "set $_ -> Automatic" }
    else      { Write-Host "service not found: $_" -ForegroundColor Yellow }
  }
```

Reboot after applying both fixes, then confirm a vanilla `WindowsSandbox.exe`
launches cleanly before re-running `Run-LocalSandbox.ps1`.

## CI integration (sketch)

Not wired up today, but here's the rough shape if you want to add it. `linux-latest` runners have Docker preinstalled, so the matrix script works out of the box. `windows-latest` runners are already disposable VMs, so you don't need Sandbox — just run `install.ps1` directly.

```yaml
# .github/workflows/test-installers.yml
name: installer-tests
on:
  pull_request:
    paths:
      - 'scripts/install.sh'
      - 'scripts/install.ps1'
      - 'scripts/install-tests/**'

jobs:
  linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run installer matrix (openai profile, local mode)
        run: MODE=local ./scripts/install-tests/linux-docker-matrix.sh

  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run install.ps1 directly on the runner
        shell: pwsh
        run: ./scripts/install.ps1 -Yes
```

Caveats: (a) same `MODE=local` limitation — the installer clones `main` from GitHub regardless, so PRs that touch only `setup-local.mjs` won't catch regressions until merge; (b) the `qwen-local` profile pulls ~3 GB per run and will slow CI noticeably — gate it on a label or a `[full]` tag in the PR title if you add it; (c) GitHub-hosted Windows runners cannot run Windows Sandbox (no nested virtualization), so isolation comes from the runner itself, not Sandbox.
