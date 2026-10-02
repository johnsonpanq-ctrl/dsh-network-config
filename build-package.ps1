# Build a portable zip of the plugin: source + installer + verifier, no tests.
[CmdletBinding()]
param(
  [string]$Source,
  [string]$Output
)

$ErrorActionPreference = 'Stop'
if (-not $Source) { $Source = $PSScriptRoot }
if (-not $Output) { $Output = Join-Path $Source 'dist' }
$name = 'dsh-network-config'
$version = (Get-Content -LiteralPath (Join-Path $Source 'package.json') -Raw | ConvertFrom-Json).version
$stage = Join-Path ([IO.Path]::GetTempPath()) "$name-build-$([guid]::NewGuid().ToString('N'))"
$root = Join-Path $stage $name

New-Item -ItemType Directory -Path $root -Force | Out-Null
foreach ($entry in 'package.json', 'cordis.patch.yml', 'README.md', 'INSTALL.md', 'install.ps1', 'verify.ps1', 'LICENSE', 'lib', 'client') {
  $from = Join-Path $Source $entry
  if (Test-Path -LiteralPath $from) {
    Copy-Item -LiteralPath $from -Destination $root -Recurse -Force
  }
}

New-Item -ItemType Directory -Path $Output -Force | Out-Null
$zip = Join-Path $Output "$name-$version.zip"
Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $root -DestinationPath $zip -CompressionLevel Optimal
Remove-Item -LiteralPath $stage -Recurse -Force

$size = [Math]::Round((Get-Item -LiteralPath $zip).Length / 1KB, 1)
Write-Host "built $zip ($size KB)"
