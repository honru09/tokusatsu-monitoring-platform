param(
  [switch]$EnableRealAdapter
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

& "$PSScriptRoot\preflight.ps1"

if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
  Write-Warning '已生成 .env。生产使用前必须修改 POSTGRES_PASSWORD、CRAWLER_CONTACT，并配置视觉服务密钥。'
}

if ($EnableRealAdapter) {
  $content = Get-Content -Raw -LiteralPath '.env'
  $content = $content -replace '(?m)^REAL_ADAPTER_ENABLED=.*$', 'REAL_ADAPTER_ENABLED=true'
  Set-Content -LiteralPath '.env' -Value $content -Encoding utf8NoBOM
}

# Keys.txt is intentionally ignored by git. Load only the DeepSeek key into
# the child compose process; never write it to tracked files or print it.
$keysPath = Join-Path $ProjectRoot 'Keys.txt'
if (Test-Path -LiteralPath $keysPath) {
  $deepSeekLine = Get-Content -LiteralPath $keysPath | Where-Object {
    $_ -match '(?i)deepseek'
  } | Select-Object -First 1
  if ($deepSeekLine) {
    # Accept common KEY=value, KEY: value, and label<TAB>value formats.
    $candidate = ($deepSeekLine.Trim() -split '[\s:=]+' | Select-Object -Last 1).Trim().Trim([char]34, [char]39)
    if ($candidate) { $env:DEEPSEEK_API_KEY = $candidate }
  }
}
$env:DEEPSEEK_API_URL = if ($env:DEEPSEEK_API_URL) { $env:DEEPSEEK_API_URL } else { 'https://api.deepseek.com' }
$env:DEEPSEEK_MODEL = if ($env:DEEPSEEK_MODEL) { $env:DEEPSEEK_MODEL } else { 'deepseek-v4-flash' }

docker compose -f infrastructure/docker-compose.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 部署失败。' }

& "$PSScriptRoot\smoke.ps1"
