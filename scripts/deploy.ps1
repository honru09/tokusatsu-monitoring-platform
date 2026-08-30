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
  $content = $content -replace '(?m)^MANDARAKE_SEARCH_ENABLED=.*$', 'MANDARAKE_SEARCH_ENABLED=true'
  $content = $content -replace '(?m)^YAHOO_AUCTIONS_SEARCH_ENABLED=.*$', 'YAHOO_AUCTIONS_SEARCH_ENABLED=true'
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $ProjectRoot '.env'), $content, $utf8NoBom)
}

# Keys.txt is intentionally ignored by git. Load supported service keys only
# into the child compose process; never write them to tracked files or print them.
$keysPath = Join-Path $ProjectRoot 'Keys.txt'
function Get-LocalSecret([string]$labelPattern) {
  if (-not (Test-Path -LiteralPath $keysPath)) { return $null }
  $line = Get-Content -LiteralPath $keysPath | Where-Object {
    $_ -match $labelPattern
  } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line.Trim() -split '[\s:=]+' | Select-Object -Last 1).Trim().Trim([char]34, [char]39)
}

if (Test-Path -LiteralPath $keysPath) {
  $firecrawlKey = Get-LocalSecret '(?i)firecrawl'
  $apifyKey = Get-LocalSecret '(?i)apify'
  if ($firecrawlKey) {
    $env:FIRECRAWL_API_KEY = $firecrawlKey
    $env:FIRECRAWL_DISCOVERY_ENABLED = 'true'
    $env:FIRECRAWL_ALLOW_ANY_DOMAIN = 'true'
  }
  if ($apifyKey) {
    $env:APIFY_TOKEN = $apifyKey
    $env:APIFY_ECOMMERCE_ENABLED = 'true'
  }
}

& "$PSScriptRoot\sync-ai-secrets.ps1" -RequireBai

docker compose -f infrastructure/docker-compose.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose 部署失败。' }

& "$PSScriptRoot\smoke.ps1"
