param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$scriptPath = Join-Path $resolvedRoot 'infrastructure/xianyu/session-bridge.cjs'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw 'Missing Xianyu bridge script' }
try {
  $health = Invoke-RestMethod -Uri 'http://localhost:3880/health' -TimeoutSec 2
  if ($health.service -eq 'xianyu-session') { Write-Output 'Xianyu bridge is running'; exit 0 }
} catch {}
$nodePath = (Get-Command node).Source
$logDir = Join-Path $resolvedRoot '.private-operations/xianyu'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $scriptPath + '"') -WorkingDirectory $resolvedRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'bridge.stdout.log') -RedirectStandardError (Join-Path $logDir 'bridge.stderr.log')
Write-Output "Xianyu bridge started: $($process.Id)"
