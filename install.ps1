# Install dsh-network-config into a DeepSeek Harness profile.
#
# Everything the install needs is in this one script:
#   1. pick a profile (desktop by default, or any profile under $DSH_HOME/profiles)
#   2. copy the plugin INSIDE that profile's node_modules
#   3. add it to the profile's dsh.profile.bundles list
#   4. verify the files land and the manifest still parses
#
# Why "copy inside the profile" and not a junction/symlink: DSH's profile
# resolver only routes bare `@deepseek-ai/*` specifiers for importers that live
# under <DSH_HOME>/profiles, so a link pointing back outside that tree fails to
# import the harness's own packages. Run this from anywhere.
#
# Usage (from the extracted folder):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
[CmdletBinding()]
param(
  # Profile to install into. "desktop" is the DeepSeek Harness desktop app.
  [string]$Profile = 'desktop',
  # Explicit profile directory; overrides -Profile when given.
  [string]$ProfileDir,
  # Remove the plugin from the profile instead of installing it.
  [switch]$Uninstall,
  # Skip the bundle-list edit (copy files only).
  [switch]$NoRegister
)

$ErrorActionPreference = 'Stop'

$pluginName = 'dsh-network-config'
$source = $PSScriptRoot

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "    $Text" -ForegroundColor Yellow }

# ---------------------------------------------------------------- DSH home ---
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
if (-not (Test-Path -LiteralPath $dshHome -PathType Container)) {
  throw "DeepSeek Harness home not found at '$dshHome'. Install and run the app once, or set DSH_HOME."
}
$profilesRoot = Join-Path $dshHome 'profiles'
if (-not (Test-Path -LiteralPath $profilesRoot -PathType Container)) {
  throw "No profiles directory at '$profilesRoot'. Run the app once so it creates its profile."
}

# ------------------------------------------------------------- resolve dir ---
if (-not $ProfileDir) {
  $ProfileDir = Join-Path $profilesRoot $Profile
}
if (-not (Test-Path -LiteralPath $ProfileDir -PathType Container)) {
  $available = (Get-ChildItem -LiteralPath $profilesRoot -Directory | Select-Object -ExpandProperty Name) -join ', '
  throw "Profile '$ProfileDir' does not exist. Available profiles: $available"
}
$ProfileDir = (Resolve-Path -LiteralPath $ProfileDir).Path
$manifestPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "'$manifestPath' not found; '$ProfileDir' does not look like a DSH profile."
}

$target = Join-Path (Join-Path $ProfileDir 'node_modules') $pluginName
Write-Step "Profile: $ProfileDir"

# ------------------------------------------------------------- read manifest -
function Read-Manifest {
  $raw = Get-Content -LiteralPath $manifestPath -Raw
  return ($raw | ConvertFrom-Json)
}
function Write-Manifest($manifest) {
  $json = $manifest | ConvertTo-Json -Depth 32
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $backup = "$manifestPath.bak-$pluginName"
  if (-not (Test-Path -LiteralPath $backup)) {
    Copy-Item -LiteralPath $manifestPath -Destination $backup -Force
  }
  [IO.File]::WriteAllText($manifestPath, $json, $utf8)
}

# -------------------------------------------------------------- uninstall ----
if ($Uninstall) {
  Write-Step 'Uninstalling'
  if (Test-Path -LiteralPath $target) {
    # Never follow a link: delete the link entry itself, not its target.
    $item = Get-Item -LiteralPath $target -Force
    if ($item.LinkType) { $item.Delete() } else { Remove-Item -LiteralPath $target -Recurse -Force }
    Write-Ok "removed $target"
  } else {
    Write-Warn2 'plugin directory was not present'
  }
  $manifest = Read-Manifest
  $bundles = @($manifest.dsh.profile.bundles) | Where-Object { $_ -ne $pluginName }
  $manifest.dsh.profile.bundles = $bundles
  Write-Manifest $manifest
  Write-Ok "removed '$pluginName' from dsh.profile.bundles"
  Write-Host ''
  Write-Host 'Restart DeepSeek Harness to finish.' -ForegroundColor Yellow
  exit 0
}

# ----------------------------------------------------------------- install ---
Write-Step 'Copying plugin into the profile'
if (Test-Path -LiteralPath $target) {
  $item = Get-Item -LiteralPath $target -Force
  if ($item.LinkType) { $item.Delete() } else { Remove-Item -LiteralPath $target -Recurse -Force }
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
$payload = @('package.json', 'cordis.patch.yml', 'README.md', 'install.ps1', 'lib', 'client')
foreach ($entry in $payload) {
  $from = Join-Path $source $entry
  if (-not (Test-Path -LiteralPath $from)) { throw "Package is incomplete: '$entry' is missing next to install.ps1." }
  Copy-Item -LiteralPath $from -Destination $target -Recurse -Force
}
Write-Ok "$target"

# The copied entry point must parse, or the profile will refuse to start it.
$entry = Join-Path $target 'lib\index.js'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Copy failed: '$entry' is missing." }
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source --check $entry
  if ($LASTEXITCODE -ne 0) { throw 'lib/index.js has a syntax error; the package is corrupt.' }
  Write-Ok 'lib/index.js parses'
} else {
  Write-Warn2 'node not on PATH; skipped the syntax check'
}

if (-not $NoRegister) {
  Write-Step 'Registering the bundle in the profile'
  $manifest = Read-Manifest
  if (-not $manifest.dsh) { throw "Unexpected manifest: 'dsh' section missing." }
  if (-not $manifest.dsh.profile) { throw "Unexpected manifest: 'dsh.profile' section missing." }
  $bundles = @($manifest.dsh.profile.bundles)
  if ($bundles -contains $pluginName) {
    Write-Ok "already listed in dsh.profile.bundles"
  } else {
    $manifest.dsh.profile.bundles = @($bundles + $pluginName)
    Write-Manifest $manifest
    Write-Ok "added '$pluginName' (backup: package.json.bak-$pluginName)"
  }
}

# ----------------------------------------------------------------- verify ----
Write-Step 'Verifying'
$manifest = Read-Manifest
$listed = @($manifest.dsh.profile.bundles) -contains $pluginName
$files = (Get-ChildItem -LiteralPath $target -Recurse -File | Measure-Object).Count
Write-Ok "files copied: $files"
Write-Ok "listed in dsh.profile.bundles: $listed"
if (-not $listed) { Write-Warn2 'the bundle is not listed; re-run without -NoRegister' }

Write-Host ''
Write-Host 'Done. Now FULLY QUIT and reopen DeepSeek Harness.' -ForegroundColor Yellow
Write-Host 'A running app cannot pick the plugin up; the module graph is built at startup.' -ForegroundColor Yellow
Write-Host 'After restarting: Settings -> Network (设置 -> 网络).' -ForegroundColor Yellow
