# Verify a running DeepSeek Harness picked up dsh-network-config.
#
# Run this AFTER restarting the app. It asks the plugin's own host routes what
# they installed, then reaches one LAN address and one public address so the
# two halves of the policy are both exercised:
#   * a private address must stay direct (a forward proxy cannot reach it)
#   * a public address must go through the configured proxy
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\verify.ps1
#   powershell -ExecutionPolicy Bypass -File .\verify.ps1 -Base http://127.0.0.1:19387
#   powershell -ExecutionPolicy Bypass -File .\verify.ps1 -Lan http://192.168.1.10:8080
[CmdletBinding()]
param(
  # Web UI origin of the running Harness.
  [string]$Base = 'http://127.0.0.1:19387',
  # A private/LAN URL to prove stays direct; optional.
  [string]$Lan,
  # A public URL to prove goes through the proxy; optional.
  [string]$Public = 'https://www.deepseek.com/'
)

$ErrorActionPreference = 'Continue'
function Line { Write-Host ('-' * 62) -ForegroundColor DarkGray }

Line
Write-Host "1. Is the plugin mounted at $Base ?" -ForegroundColor Cyan
$state = $null
try {
  $state = (Invoke-WebRequest -Uri "$Base/dsh-network-config/state" -TimeoutSec 10 -UseBasicParsing).Content | ConvertFrom-Json
} catch {
  Write-Host "   NO - the route is not answering ($($_.Exception.Message))" -ForegroundColor Red
  Write-Host '   Checks: did the install script run, and did the app fully restart?' -ForegroundColor Yellow
  Write-Host '   A profile rebuild only happens at startup.' -ForegroundColor Yellow
  exit 1
}
Write-Host '   YES' -ForegroundColor Green

Line
Write-Host '2. What is configured / in effect' -ForegroundColor Cyan
$s = $state.state
Write-Host "   mode          : $($s.config.mode)"
if ($s.applied) {
  Write-Host "   route         : $(if ($s.applied.direct) { 'direct (no proxy)' } else { $s.applied.summary })"
  Write-Host "   bypass entries: $($s.applied.bypassCount)"
  Write-Host "   private direct: $($s.applied.privateDirect)"
  Write-Host "   full matcher  : $($s.applied.fullBypass)"
} else {
  Write-Host '   route         : NOT INSTALLED' -ForegroundColor Red
}
if ($s.system) {
  Write-Host "   system proxy  : $(if ($s.system.enabled) { 'enabled' } else { 'disabled' }) $($s.system.server)"
}
foreach ($note in @($s.diagnostics)) { Write-Host "   note: $note" -ForegroundColor Yellow }
if ($s.lastError) { Write-Host "   ERROR: $($s.lastError)" -ForegroundColor Red }

if (-not $s.applied) { exit 1 }
if ($s.applied.fullBypass -eq $false) {
  Write-Host '   The full bypass matcher is not installed (undici was unresolvable).' -ForegroundColor Yellow
  Write-Host '   Wildcard entries such as 192.168.* and private-address bypass will not apply.' -ForegroundColor Yellow
}

function Probe([string]$Label, [string]$Url) {
  if (-not $Url) { return }
  Line
  Write-Host "3. Reach $Label : $Url" -ForegroundColor Cyan
  $body = @{ url = $Url } | ConvertTo-Json -Compress
  try {
    $r = (Invoke-WebRequest -Uri "$Base/dsh-network-config/probe" -Method POST -Body $body `
        -ContentType 'application/json' -TimeoutSec 40 -UseBasicParsing).Content | ConvertFrom-Json
    $res = $r.result
    if ($res.ok) {
      Write-Host "   reachable - HTTP $($res.status) in $($res.ms) ms" -ForegroundColor Green
      if ($res.ms -gt 3000) {
        Write-Host '   slow: a proxied LAN address typically shows up as a multi-second stall' -ForegroundColor Yellow
      }
    } else {
      Write-Host "   UNREACHABLE in $($res.ms) ms - $($res.error)" -ForegroundColor Red
      if ($res.ms -gt 3000) {
        Write-Host '   A multi-second failure here usually means the address went through the proxy.' -ForegroundColor Yellow
      }
    }
  } catch {
    Write-Host "   probe call failed: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Probe 'a private/LAN address (must stay direct)' $Lan
Probe 'a public address (must use the proxy)' $Public

Line
Write-Host 'Done.' -ForegroundColor Cyan
Write-Host 'Open Settings -> Network (设置 -> 网络) to change the mode.' -ForegroundColor Cyan
