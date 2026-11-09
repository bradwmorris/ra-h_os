# One-line installer for RA-H OS (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/bradwmorris/ra-h_os/main/scripts/install.ps1 | iex
# Or with options: & ([scriptblock]::Create((irm ...install.ps1))) -AiProfile qwen-local -LlmPort 8080 -EmbeddingPort 8081
param(
  [string]$AiProfile     = "openai",
  [string]$InstallDir    = "ra-h_os",
  [int]   $LlmPort       = 8080,
  [int]   $EmbeddingPort = 8081,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/bradwmorris/ra-h_os.git"

function Info  { param($msg) Write-Host "[ra-h] $msg" -ForegroundColor Green }
function Warn  { param($msg) Write-Host "[ra-h] $msg" -ForegroundColor Yellow }
function Abort { param($msg) Write-Host "[ra-h] ERROR: $msg" -ForegroundColor Red; exit 1 }
function Ask   {
  param($msg)
  if ($Yes) { return $true }
  $ans = Read-Host "[ra-h] $msg [y/N]"
  return $ans -match '^[Yy]'
}
# Windows PowerShell 5.1 does not stop on a native command's nonzero exit code,
# even with $ErrorActionPreference = "Stop". Call this right after each native
# command whose failure must abort the install.
function Assert-NativeSuccess {
  param($what)
  if ($LASTEXITCODE -ne 0) { Abort "$what failed (exit code $LASTEXITCODE)." }
}
# The app requires Node 22+ (package.json engines, bootstrap-local.mjs).
# Suffix stripping keeps pre-release tags such as "22.12.0-rc.1" parseable.
$MinNodeMajor = 22
function Get-NodeMajor {
  $v = (node -e "process.stdout.write(process.versions.node)").Trim()
  return [int](($v.Split('.')[0]) -replace '[^\d].*$','')
}

# -- git check ----------------------------------------------------------------

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Abort "git is required but not installed. See https://git-scm.com"
}

# -- Node.js check ------------------------------------------------------------

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Warn "Node.js is not installed."
  if (Ask "Install Node.js LTS (v$MinNodeMajor+) via winget now?") {
    Info "Installing Node.js LTS..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Abort "winget not available. Install Node.js manually from https://nodejs.org then re-run."
    }
    winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User") + ";" +
                $env:Path
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      Abort "Node.js installation failed. Install manually from https://nodejs.org"
    }
  } else {
    Abort "Node.js v$MinNodeMajor+ is required. Install from https://nodejs.org then re-run."
  }
}

if ((Get-NodeMajor) -lt $MinNodeMajor) {
  Warn "Node.js $(node --version) is too old."
  if (Ask "Upgrade Node.js to the current LTS (v$MinNodeMajor+) via winget now?") {
    Info "Upgrading Node.js to the current LTS..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Abort "winget not available. Install Node.js v$MinNodeMajor+ manually from https://nodejs.org then re-run."
    }
    winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User") + ";" +
                $env:Path
    if ((Get-NodeMajor) -lt $MinNodeMajor) { Abort "Node.js upgrade did not reach v$MinNodeMajor+. Install manually from https://nodejs.org" }
    Info "Node.js upgraded to $(node --version)."
  } else {
    Abort "Node.js v$MinNodeMajor or higher is required (found $(node --version)). See https://nodejs.org"
  }
}

# -- Clone --------------------------------------------------------------------

if (Test-Path $InstallDir) {
  Warn "Directory '$InstallDir' already exists - pulling latest changes."
  git -C $InstallDir rev-parse --git-dir 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Abort "Directory '$InstallDir' exists but is not a git repository. Remove it and re-run." }
  git -C $InstallDir pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    Warn "Could not fast-forward pull (local changes or diverged history) - using existing state."
  }
} else {
  Info "Cloning RA-H OS into '$InstallDir'..."
  git clone $RepoUrl $InstallDir
  Assert-NativeSuccess "git clone"
}

Set-Location $InstallDir

# -- Profile pre-flight -------------------------------------------------------

function Test-OllamaDaemon {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:11434" -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch { return $false }
}

function Start-OllamaDaemon {
  Info "Starting Ollama daemon..."
  try {
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden -ErrorAction Stop
  } catch {
    Warn "Failed to launch ollama serve: $($_.Exception.Message)"
    return $false
  }
  # A "port in use" failure from our `ollama serve` is fine -- it means another
  # Ollama server (e.g. the winget desktop app) already owns 11434; we just wait
  # for it to answer. Poll generously for that.
  $i = 0
  while ($i -lt 30) {
    if (Test-OllamaDaemon) { return $true }
    Start-Sleep 1; $i++
  }
  return $false
}

if ($AiProfile -eq "qwen-local") {
  $ollamaJustInstalled = $false
  # -- Install Ollama if missing --
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Warn "Ollama is not installed."
    if (Ask "Install Ollama now?") {
      Info "Installing Ollama..."
      if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Abort "winget not available. Install Ollama manually from https://ollama.com then re-run."
      }
      winget install Ollama.Ollama --source winget --accept-package-agreements --accept-source-agreements --silent
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                  [System.Environment]::GetEnvironmentVariable("Path","User") + ";" +
                  $env:Path
      if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Abort "Ollama installation failed. Install manually from https://ollama.com"
      }
      $ollamaJustInstalled = $true
    } else {
      Abort "Ollama is required for the qwen-local profile. Install from https://ollama.com then re-run."
    }
  }

  # -- Start daemon if not running --
  # The winget Ollama package installs the desktop app, which auto-starts its own
  # server on 11434 shortly after install. Wait for that before spawning our own
  # `ollama serve` -- two servers racing for 11434 leaves neither bound.
  if ($ollamaJustInstalled -and -not (Test-OllamaDaemon)) {
    Info "Waiting for the Ollama app to start its daemon..."
    $w = 0
    while ($w -lt 30 -and -not (Test-OllamaDaemon)) { Start-Sleep 1; $w++ }
  }

  if (-not (Test-OllamaDaemon)) {
    Warn "Ollama daemon is not running."
    if (Ask "Start Ollama now?") {
      if (-not (Start-OllamaDaemon)) {
        Abort "Ollama daemon failed to start. Launch Ollama from the Start Menu or run 'ollama serve' then re-run."
      }
      Warn "Ollama running as a background process - not persistent across reboots. To install as a Windows service, see: https://github.com/ollama/ollama/blob/main/docs/windows.md"
      Info "Ollama daemon is running."
    } else {
      Abort "Ollama must be running to pull models. Launch it from the Start Menu or run: ollama serve"
    }
  } else {
    Info "Ollama daemon is running."
  }

  Info "Pulling qwen3:4b (utility model)..."
  ollama pull qwen3:4b
  Assert-NativeSuccess "ollama pull qwen3:4b"

  Info "Pulling qwen3-embedding:0.6b (embedding model)..."
  ollama pull qwen3-embedding:0.6b
  Assert-NativeSuccess "ollama pull qwen3-embedding:0.6b"
}

if ($AiProfile -eq "llama-cpp") {
  Info "Checking llama.cpp servers (ports $LlmPort / $EmbeddingPort)..."
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$LlmPort/v1/models" -UseBasicParsing -TimeoutSec 3 | Out-Null
  } catch {
    Abort "No llama.cpp server on port $LlmPort. Start it first:`n  llama-server -m C:\path\to\qwen3-4b.gguf --port $LlmPort"
  }
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$EmbeddingPort/v1/models" -UseBasicParsing -TimeoutSec 3 | Out-Null
  } catch {
    Abort "No llama.cpp embedding server on port $EmbeddingPort. Start it first:`n  llama-server -m C:\path\to\qwen3-embedding-0.6b.gguf --embedding --port $EmbeddingPort"
  }
  Info "llama.cpp servers reachable on ports $LlmPort and $EmbeddingPort."
}

# -- Install & setup ----------------------------------------------------------

Info "Installing dependencies..."
# Call npm.cmd, not npm: under the default Restricted execution policy the
# npm.ps1 shim that `npm` resolves to is blocked from running.
npm.cmd install
Assert-NativeSuccess "npm install"

Info "Running setup (profile: $AiProfile)..."
# The documented `irm | iex` invocation runs in the caller's session, so scope the
# llama.cpp URL overrides to this setup run and restore the previous values after
# (a later qwen-local install in the same session must not inherit them).
$prevLlmBaseUrl       = $env:LLM_BASE_URL
$prevEmbeddingBaseUrl = $env:EMBEDDING_BASE_URL
try {
  if ($AiProfile -eq "llama-cpp") {
    $env:LLM_BASE_URL       = "http://127.0.0.1:$LlmPort/v1"
    $env:EMBEDDING_BASE_URL = "http://127.0.0.1:$EmbeddingPort/v1"
  }
  npm.cmd run setup:local -- --profile $AiProfile
  Assert-NativeSuccess "npm run setup:local"
} finally {
  $env:LLM_BASE_URL       = $prevLlmBaseUrl
  $env:EMBEDDING_BASE_URL = $prevEmbeddingBaseUrl
}
if (Test-Path ".env.local") {
  if ([string]::IsNullOrEmpty($env:USERNAME)) {
    Warn ".env.local exists but USERNAME env var is empty - skipping ACL hardening."
  } else {
    icacls ".env.local" /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
    Assert-NativeSuccess "Restricting .env.local permissions (icacls)"
  }
}

# -- OpenAI API key -----------------------------------------------------------

if ($AiProfile -eq "openai") {
  $oaiKeyPlain   = $env:OPENAI_API_KEY
  $envLocal      = ".env.local"
  # -Encoding UTF8: bootstrap writes .env.local as BOM-less UTF-8, which Windows
  # PowerShell 5.1 would otherwise read as ANSI and corrupt non-ASCII values on rewrite.
  $keyAlreadySet = (Test-Path $envLocal) -and (Get-Content $envLocal -Raw -Encoding UTF8) -match '(?m)^OPENAI_API_KEY=.'

  if ($oaiKeyPlain) {
    Info "OPENAI_API_KEY found in environment - writing to .env.local."
  } elseif ($keyAlreadySet) {
    Info "OPENAI_API_KEY already set in .env.local - skipping."
    $oaiKeyPlain = $null
  } elseif ($Yes) {
    Warn "No OPENAI_API_KEY in environment. Add it later in Settings -> API Keys."
  } else {
    Write-Host ""
    Info "Enter your OpenAI API key to write it to .env.local now."
    Info "Press Enter to skip - you can add it later in Settings -> API Keys."
    $oaiSecure   = Read-Host "[ra-h] OpenAI API key" -AsSecureString
    $oaiPtr      = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($oaiSecure)
    $oaiKeyPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($oaiPtr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($oaiPtr)
  }

  if ($oaiKeyPlain) {
    # Escape key for .NET regex replacement ($N is a backreference)
    $oaiKeyEsc  = $oaiKeyPlain -replace '\$', '$$$$'
    $utf8NoBom  = [System.Text.UTF8Encoding]::new($false)
    $envLocalAbs = Join-Path (Get-Location).Path $envLocal
    # $oaiKeyEsc only needed for -replace (where $ is a regex backreference);
    # string interpolation and AppendAllText do not interpret metacharacters.
    if (Test-Path $envLocal) {
      $content = Get-Content $envLocal -Raw -Encoding UTF8
      if ($content -match '(?m)^OPENAI_API_KEY=') {
        $content = $content -replace '(?m)^OPENAI_API_KEY=.*', "OPENAI_API_KEY=$oaiKeyEsc"
      } else {
        $content = $content.TrimEnd() + "`r`nOPENAI_API_KEY=$oaiKeyPlain`r`n"
      }
      [System.IO.File]::WriteAllText($envLocalAbs, $content, $utf8NoBom)
    } else {
      [System.IO.File]::AppendAllText($envLocalAbs, "OPENAI_API_KEY=$oaiKeyPlain`r`n", $utf8NoBom)
    }
    if (-not [string]::IsNullOrEmpty($env:USERNAME)) {
      icacls $envLocal /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
      Assert-NativeSuccess "Restricting .env.local permissions (icacls)"
    }
    Info "OpenAI API key saved to .env.local"
  } elseif (-not $Yes -and -not $keyAlreadySet) {
    Warn "Skipped - add your key later in Settings -> API Keys."
  }
}

# -- Vector extension check ---------------------------------------------------

$vecDll = "vendor\sqlite-extensions\vec0.dll"
if (Test-Path $vecDll) {
  Info "sqlite-vec extension found: $vecDll"
} else {
  Warn "sqlite-vec extension (vec0.dll) not found at $vecDll"
  Warn "Vector search will be unavailable on Windows without it. Options:"
  Warn "  1. Download vec0.dll for your architecture from https://github.com/asg017/sqlite-vec/releases"
  Warn "     and place it at $((Resolve-Path .).Path)\$vecDll"
  Warn "  2. Use Qdrant as the vector backend - see QDRANT-DEPLOYMENT.md"
}

# -- Done ---------------------------------------------------------------------

Write-Host ""
Info "Installation complete!"
Write-Host ""
# Absolute path: under `irm | iex` this session is already inside the install
# directory, so a relative `cd ra-h_os` would point at a nonexistent nested folder.
# npm.cmd / npx.cmd: the npm.ps1 / npx.ps1 shims are blocked by a Restricted policy.
$installPath = (Get-Location).Path
Write-Host "  Start the app:  cd '$($installPath -replace "'", "''")'; npm.cmd run dev"
Write-Host "  Then open:      http://localhost:3000"
Write-Host ""
Write-Host "  Optional MCP setup (Claude Code / Cursor):"
Write-Host "  npx.cmd -y ra-h-mcp-server@latest setup --client claude-code --yes"
Write-Host ""
