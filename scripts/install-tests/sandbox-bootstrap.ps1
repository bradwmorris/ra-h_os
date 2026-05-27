# Bootstraps git + Node.js into a fresh Windows Sandbox session, then runs the
# RA-H installer. A vanilla Windows Sandbox ships without git OR winget, so
# install.ps1 alone can only ever reach its git-preflight abort. This script
# fetches portable git (MinGit) and a Node.js zip, puts both on the session
# PATH, and hands off to the installer.
#
# Mirrors the Linux harness's MODE switch (see linux-docker-matrix.sh):
#   -Mode local  (default) : run the mounted working-copy install.ps1 AND
#                            pre-clone the branch from the mount, so the whole
#                            PR is exercised (branch script + branch app code).
#   -Mode remote           : fetch install.ps1 from GitHub at -Ref and run it,
#                            letting it clone the published repo (main).
#
# Invoked only by Run-LocalSandbox.ps1 inside the sandbox. Never run on a host.
param(
  [Parameter(Mandatory)][string]$SrcPath,
  [ValidateSet('local','remote')][string]$Mode = 'local',
  [string]$Ref       = 'main',
  [string]$AiProfile = 'openai',
  # For the llama-cpp profile: -Heavy provisions a REAL llama-server + GGUF
  # models instead of the lightweight mock. No effect on other profiles.
  [switch]$Heavy,
  # -Winget installs winget (App Installer) into the sandbox and SKIPS the
  # portable Node/Ollama bootstrap, so install.ps1's own winget paths run
  # (Node install/upgrade, Ollama install). Without it the portable provisioning
  # means install.ps1 finds those deps present and never touches winget.
  [switch]$Winget
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Info { param($m) Write-Host "[bootstrap] $m" -ForegroundColor Magenta }

# Stream a download straight to disk. Invoke-WebRequest -OutFile buffers the
# entire response in memory on Windows PowerShell 5.1, which truncates large
# files (e.g. the ~2GB Ollama zip) in a memory-limited sandbox and yields a
# corrupt archive. WebClient streams to disk with a small buffer.
function Save-File {
  param([Parameter(Mandatory)][string]$Url, [Parameter(Mandatory)][string]$OutFile)
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent', 'ra-h-sandbox')
  try { $wc.DownloadFile($Url, $OutFile) } finally { $wc.Dispose() }
}

# Native server binaries (ollama.exe via winget's OllamaSetup, prebuilt
# llama-server.exe) link against the MSVC runtime (VCRUNTIME140.dll), which a
# vanilla sandbox lacks. winget/OllamaSetup install it but ASYNCHRONOUSLY, so a
# daemon start can race ahead of it. Install it synchronously up front.
function Install-VCRuntime {
  if (Test-Path "$env:SystemRoot\System32\vcruntime140.dll") { Info 'Visual C++ runtime already present.'; return }
  Info 'Installing Visual C++ runtime (vc_redist.x64)...'
  $vc = Join-Path $env:TEMP 'vc_redist.x64.exe'
  Save-File 'https://aka.ms/vs/17/release/vc_redist.x64.exe' $vc
  Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Wait
  Info 'Visual C++ runtime installed.'
}

Info "Mode: $Mode | Ref: $Ref | Profile: $AiProfile | Winget: $($Winget.IsPresent)"

$Tools = 'C:\tools'
New-Item -ItemType Directory -Path $Tools -Force | Out-Null

# Install winget (App Installer) into the sandbox from microsoft/winget-cli.
# A vanilla Sandbox ships without it; this side-loads the MSIX bundle plus its
# VCLibs / UI.Xaml dependencies so install.ps1's `winget install` calls work.
function Install-Winget {
  if (Get-Command winget -ErrorAction SilentlyContinue) { Info "winget already present: $(winget --version)"; return }
  Info 'Installing winget (App Installer) from microsoft/winget-cli...'
  $rel    = Invoke-RestMethod 'https://api.github.com/repos/microsoft/winget-cli/releases/latest' `
              -Headers @{ 'User-Agent' = 'ra-h-sandbox' }
  $bundle = $rel.assets | Where-Object { $_.name -like '*.msixbundle' } | Select-Object -First 1
  $deps   = $rel.assets | Where-Object { $_.name -eq 'DesktopAppInstaller_Dependencies.zip' } | Select-Object -First 1
  if (-not $bundle) { throw 'winget .msixbundle not found in the latest winget-cli release.' }

  if ($deps) {
    $depsZip = Join-Path $env:TEMP $deps.name
    Info "Downloading $($deps.name)..."
    Save-File $deps.browser_download_url $depsZip
    $depsDir = Join-Path $env:TEMP 'winget-deps'
    Expand-Archive -Path $depsZip -DestinationPath $depsDir -Force
    Get-ChildItem -Path (Join-Path $depsDir 'x64') -Filter *.appx -ErrorAction SilentlyContinue | ForEach-Object {
      try { Add-AppxPackage -Path $_.FullName -ErrorAction Stop; Info "  dep: $($_.Name)" }
      catch { Write-Host "[bootstrap] dependency add warning ($($_.Name)): $($_.Exception.Message)" -ForegroundColor Yellow }
    }
  }

  $bundlePath = Join-Path $env:TEMP $bundle.name
  Info "Downloading $($bundle.name)..."
  Save-File $bundle.browser_download_url $bundlePath
  Add-AppxPackage -Path $bundlePath

  # winget.exe is an execution alias in the user's WindowsApps dir; ensure it is
  # on this session's PATH so the child install.ps1 (run via `&`) inherits it.
  $wa = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
  if ($env:Path -notlike "*$wa*") { $env:Path = "$wa;$env:Path" }

  if (Get-Command winget -ErrorAction SilentlyContinue) { Info "winget installed: $(winget --version)" }
  else { Write-Host '[bootstrap] WARNING: winget not detected after install; install.ps1 winget paths will abort.' -ForegroundColor Yellow }
}

if ($Winget) { Install-Winget }

# Ensure the MSVC runtime is present BEFORE install.ps1 starts Ollama (winget
# path) or before we launch llama-server (-Heavy), so neither races the async
# vc_redist install that OllamaSetup/winget would otherwise trigger.
if (($AiProfile -eq 'qwen-local' -and $Winget) -or ($AiProfile -eq 'llama-cpp' -and $Heavy)) {
  Install-VCRuntime
}

# -- git (portable MinGit, no installer) --------------------------------------
if (Get-Command git -ErrorAction SilentlyContinue) {
  Info "git already present: $(git --version)"
} else {
  Info 'Resolving latest MinGit (git-for-windows)...'
  $rel   = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' `
             -Headers @{ 'User-Agent' = 'ra-h-sandbox' }
  $asset = $rel.assets | Where-Object { $_.name -match '^MinGit-.*-64-bit\.zip$' } | Select-Object -First 1
  if (-not $asset) { throw 'Could not find a MinGit 64-bit asset in the latest git-for-windows release.' }
  $zip = Join-Path $env:TEMP $asset.name
  Info "Downloading $($asset.name)..."
  Save-File $asset.browser_download_url $zip
  $gitDir = Join-Path $Tools 'git'
  Expand-Archive -Path $zip -DestinationPath $gitDir -Force
  $env:Path = "$gitDir\cmd;$env:Path"
  Info "git installed: $(git --version)"
}

# -- Node.js (portable zip, latest LTS) ---------------------------------------
# With -Winget we deliberately leave Node absent so install.ps1 installs it via
# winget itself (exercising that path); otherwise provision the portable zip.
if ($Winget) {
  Info 'Skipping portable Node - install.ps1 will install it via winget.'
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
  Info "node already present: $(node --version)"
} else {
  # Resolve the current LTS dynamically. This mirrors what a real user gets from
  # `winget install OpenJS.NodeJS.LTS`, and avoids the vite EBADENGINE warning
  # that Node 20.18.x triggers. index.json is newest-first, so the first entry
  # with a truthy `lts` field is the current LTS line.
  Info 'Resolving latest Node.js LTS...'
  $idx     = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $lts     = $idx | Where-Object { $_.lts } | Select-Object -First 1
  $nodeVer = $lts.version
  $nodeName = "node-$nodeVer-win-x64"
  Info "Downloading Node.js $nodeVer ($($lts.lts) LTS)..."
  $zip = Join-Path $env:TEMP "$nodeName.zip"
  Save-File "https://nodejs.org/dist/$nodeVer/$nodeName.zip" $zip
  Expand-Archive -Path $zip -DestinationPath $Tools -Force
  $env:Path = "$Tools\$nodeName;$env:Path"
  Info "node installed: $(node --version), npm $(npm --version)"
}

# -- Ollama (only for the qwen-local profile) ---------------------------------
# install.ps1 installs Ollama via winget, which a vanilla sandbox lacks. Provide
# the portable Windows build so install.ps1 finds it, starts the daemon, and
# pulls the models itself.
if ($AiProfile -eq 'qwen-local' -and -not $Winget -and -not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Info 'Resolving latest Ollama (windows-amd64)...'
  $orel   = Invoke-RestMethod 'https://api.github.com/repos/ollama/ollama/releases/latest' `
              -Headers @{ 'User-Agent' = 'ra-h-sandbox' }
  $oasset = $orel.assets | Where-Object { $_.name -eq 'ollama-windows-amd64.zip' } | Select-Object -First 1
  if (-not $oasset) { throw 'Could not find ollama-windows-amd64.zip in the latest Ollama release.' }
  $ozip = Join-Path $env:TEMP $oasset.name
  Info "Downloading $($oasset.name) ($([math]::Round($oasset.size/1MB)) MB)..."
  Save-File $oasset.browser_download_url $ozip
  $ollamaDir = Join-Path $Tools 'ollama'
  Expand-Archive -Path $ozip -DestinationPath $ollamaDir -Force
  $env:Path = "$ollamaDir;$env:Path"
  Info "ollama binary ready: $ollamaDir (install.ps1 will start the daemon and pull models)"
}

# -- llama.cpp servers (only for the llama-cpp profile) -----------------------
# install.ps1 probes /v1/models on the LLM + embedding ports (8080/8081, its
# defaults) and aborts if nothing answers. Bring those ports up first:
#   -Heavy : a REAL llama-server + GGUF models (downloads hundreds of MB)
#   else   : a tiny Node mock (mirrors fixtures/llama-cpp-mock-server.py)
if ($AiProfile -eq 'llama-cpp' -and $Heavy) {
  Info 'Provisioning REAL llama.cpp (server + models)...'
  $assetRe = if ($env:LLAMACPP_ASSET_RE) { $env:LLAMACPP_ASSET_RE } else { 'bin-win-cpu-x64\.zip' }
  # The latest release can be mid-CI and missing the CPU x64 zip; search recent
  # releases (newest-first) and take the first matching asset.
  $rels    = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15' `
               -Headers @{ 'User-Agent' = 'ra-h-sandbox' }
  $lasset  = $rels | ForEach-Object { $_.assets } | Where-Object { $_.name -match $assetRe } | Select-Object -First 1
  if (-not $lasset) { throw "No llama.cpp asset matching /$assetRe/ in recent releases." }
  $lzip = Join-Path $env:TEMP $lasset.name
  Info "Downloading $($lasset.name) ($([math]::Round($lasset.size/1MB)) MB)..."
  Save-File $lasset.browser_download_url $lzip
  $llamaDir = Join-Path $Tools 'llama'
  Expand-Archive -Path $lzip -DestinationPath $llamaDir -Force
  $server = Get-ChildItem -Path $llamaDir -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
  if (-not $server) { throw 'llama-server.exe not found in the llama.cpp release zip.' }

  $chatUrl  = if ($env:CHAT_GGUF_URL)  { $env:CHAT_GGUF_URL }  else { 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf' }
  $embedUrl = if ($env:EMBED_GGUF_URL) { $env:EMBED_GGUF_URL } else { 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf' }
  $chatPath  = Join-Path $env:TEMP 'chat.gguf'
  $embedPath = Join-Path $env:TEMP 'embed.gguf'
  Info 'Downloading chat model...';      Save-File $chatUrl  $chatPath
  Info 'Downloading embedding model...'; Save-File $embedUrl $embedPath

  # MSVC runtime was installed up front by Install-VCRuntime (see top of script).
  Info 'Starting real llama.cpp servers on 8080/8081...'
  Start-Process -FilePath $server.FullName -WindowStyle Hidden -ArgumentList @('-m', $chatPath,  '--host', '127.0.0.1', '--port', '8080', '-c', '512')
  Start-Process -FilePath $server.FullName -WindowStyle Hidden -ArgumentList @('-m', $embedPath, '--host', '127.0.0.1', '--port', '8081', '--embedding', '-c', '512')
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest 'http://127.0.0.1:8080/v1/models' -UseBasicParsing -TimeoutSec 1 | Out-Null
      Invoke-WebRequest 'http://127.0.0.1:8081/v1/models' -UseBasicParsing -TimeoutSec 1 | Out-Null
      $ready = $true; break
    } catch { Start-Sleep -Seconds 2 }
  }
  if ($ready) { Info 'Real llama.cpp servers ready.' }
  else { Write-Host '[bootstrap] WARNING: real llama.cpp servers not reachable; install.ps1 may abort.' -ForegroundColor Yellow }
}
elseif ($AiProfile -eq 'llama-cpp') {
  $mockJs = @'
const http = require('http');
for (const port of [8080, 8081]) {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"object":"list","data":[{"id":"mock"}]}');
  }).listen(port, '127.0.0.1');
}
setInterval(() => {}, 1e9);
'@
  $mockPath = Join-Path $env:TEMP 'llama-cpp-mock.js'
  [System.IO.File]::WriteAllText($mockPath, $mockJs, [System.Text.UTF8Encoding]::new($false))
  Info 'Starting mock llama.cpp servers on 8080/8081...'
  Start-Process node -ArgumentList $mockPath -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 10; $i++) {
    try { Invoke-WebRequest 'http://127.0.0.1:8080/v1/models' -UseBasicParsing -TimeoutSec 1 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Seconds 1 }
  }
  if ($ready) { Info 'Mock llama.cpp servers ready.' }
  else { Write-Host '[bootstrap] WARNING: mock servers not reachable yet; install.ps1 may abort.' -ForegroundColor Yellow }
}

# -- run the installer (mode-dependent) ---------------------------------------
# `&` runs install.ps1 in THIS session so it inherits the PATH set above.
# install.ps1 calls `exit` on abort, which ends this child process - the outer
# (-NoExit) sandbox window survives and reports the propagated exit code.
if ($Mode -eq 'local') {
  # Pre-clone the branch from the read-only mount so the mounted install.ps1
  # finds an existing repo and `git pull`s from the mount (the branch's
  # committed HEAD) instead of cloning main. CWD is the Desktop (set by the
  # launcher), matching install.ps1's default InstallDir of "ra-h_os".
  $installDir = Join-Path (Get-Location).Path 'ra-h_os'
  if (Test-Path $installDir) {
    Info "Install dir already exists: $installDir"
  } else {
    # The mounted .git is owned by the host user; inside the sandbox we are
    # WDAGUtilityAccount (a different SID), so git refuses with "dubious
    # ownership". The sandbox is disposable, so trust everything for this session.
    git config --global --add safe.directory '*'
    Info "Pre-cloning branch from mount: $SrcPath"
    git clone $SrcPath $installDir
    Info "Cloned branch HEAD: $(git -C $installDir rev-parse --abbrev-ref HEAD) @ $(git -C $installDir rev-parse --short HEAD)"
  }
  Info "Running mounted install.ps1 (profile: $AiProfile)..."
  & "$SrcPath\scripts\install.ps1" -AiProfile $AiProfile -Yes
} else {
  $url = "https://raw.githubusercontent.com/bradwmorris/ra-h_os/$Ref/scripts/install.ps1"
  Info "Fetching install.ps1 from $url ..."
  $script = Invoke-RestMethod -Uri $url -UseBasicParsing
  Info "Running remote install.ps1 (profile: $AiProfile)..."
  & ([scriptblock]::Create($script)) -AiProfile $AiProfile -Yes
}
Info "installer completed without aborting (exit code $LASTEXITCODE)."
