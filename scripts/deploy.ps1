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

docker compose -f infrastructure/docker-compose.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 部署失败。' }

& "$PSScriptRoot\smoke.ps1"
