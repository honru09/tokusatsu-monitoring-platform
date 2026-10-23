param(
  [switch]$EnableRealAdapter,
  [switch]$EnableAiGateway
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

& "$PSScriptRoot\preflight.ps1"

function New-RandomHex([int]$byteLength) {
  $bytes = New-Object byte[] $byteLength
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Get-DotEnvValue([string]$content, [string]$name) {
  $match = [regex]::Match($content, "(?m)^$([regex]::Escape($name))=(.*)$")
  if (-not $match.Success) { return $null }
  return $match.Groups[1].Value.Trim().Trim([char]34, [char]39)
}

function Set-DotEnvValue([string]$content, [string]$name, [string]$value) {
  $pattern = "(?m)^$([regex]::Escape($name))=.*$"
  $line = "$name=$value"
  $match = [regex]::Match($content, $pattern)
  if ($match.Success) {
    # Avoid replacement-string expansion when a recovered secret contains '$'.
    return $content.Substring(0, $match.Index) + $line + $content.Substring($match.Index + $match.Length)
  }
  if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
  return $content + $line + "`r`n"
}

function Get-ExistingPostgresPassword {
  # Reuse the password already attached to an existing Compose container so a
  # persistent database is never silently paired with a newly generated value.
  $containerId = docker ps -a --filter 'label=com.docker.compose.project=tokusatsu-monitor' --filter 'label=com.docker.compose.service=postgres' --format '{{.ID}}' | Select-Object -First 1
  if (-not $containerId) { return $null }
  $entry = docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $containerId | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' } | Select-Object -First 1
  if (-not $entry) { return $null }
  return $entry.Substring('POSTGRES_PASSWORD='.Length)
}

$envPath = Join-Path $ProjectRoot '.env'
$createdEnv = -not (Test-Path -LiteralPath $envPath)
if ($createdEnv) {
  Copy-Item -LiteralPath '.env.example' -Destination $envPath
}

$content = Get-Content -Raw -LiteralPath $envPath
$postgresPassword = Get-DotEnvValue $content 'POSTGRES_PASSWORD'
if ([string]::IsNullOrWhiteSpace($postgresPassword)) {
  $postgresPassword = Get-ExistingPostgresPassword
  if ([string]::IsNullOrWhiteSpace($postgresPassword)) {
    $volumeExists = docker volume inspect 'tokusatsu-monitor_postgres_data' 2>$null
    if ($LASTEXITCODE -eq 0 -and $volumeExists) {
      throw '检测到已有 PostgreSQL 数据卷，但无法恢复原密码。请把原 POSTGRES_PASSWORD 写回 .env；为保护现有数据，部署脚本不会生成新密码。'
    }
    $postgresPassword = New-RandomHex 32
  }
  $escapedPostgresPassword = $postgresPassword.Replace("'", "\'")
  $content = Set-DotEnvValue $content 'POSTGRES_PASSWORD' "'$escapedPostgresPassword'"
}

$databaseUrl = Get-DotEnvValue $content 'DATABASE_URL'
if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $databaseUrl -match '^postgres(?:ql)?://[^@]+@postgres(?::\d+)?/') {
  $postgresUser = Get-DotEnvValue $content 'POSTGRES_USER'
  $postgresDb = Get-DotEnvValue $content 'POSTGRES_DB'
  if ([string]::IsNullOrWhiteSpace($postgresUser)) { $postgresUser = 'tokusatsu' }
  if ([string]::IsNullOrWhiteSpace($postgresDb)) { $postgresDb = 'tokusatsu' }
  $encodedPassword = [System.Uri]::EscapeDataString($postgresPassword)
  $databaseUrl = 'postgresql' + '://' + $postgresUser + ':' + $encodedPassword + '@postgres:5432/' + $postgresDb + '?schema=public'
  $content = Set-DotEnvValue $content 'DATABASE_URL' $databaseUrl
}

$internalToken = Get-DotEnvValue $content 'AI_INTERNAL_TOKEN'
if ([string]::IsNullOrWhiteSpace($internalToken)) {
  $content = Set-DotEnvValue $content 'AI_INTERNAL_TOKEN' (New-RandomHex 48)
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envPath, $content, $utf8NoBom)

if ($createdEnv) {
  Write-Warning '已生成 .env，并写入随机数据库密码与内部 API 令牌。生产使用前仍需修改 CRAWLER_CONTACT，并通过 Secret Manager 配置服务密钥。'
}

if ($EnableRealAdapter) {
  $content = Get-Content -Raw -LiteralPath '.env'
  $content = $content -replace '(?m)^REAL_ADAPTER_ENABLED=.*$', 'REAL_ADAPTER_ENABLED=true'
  # Mandarake's former public search endpoint currently redirects to the
  # storefront home page. Keep scheduled discovery off until a verified,
  # robots-compliant catalogue endpoint is available; pasted detail URLs can
  # still be handled independently by the URL-analysis path.
  $content = $content -replace '(?m)^MANDARAKE_SEARCH_ENABLED=.*$', 'MANDARAKE_SEARCH_ENABLED=false'
  $content = $content -replace '(?m)^YAHOO_AUCTIONS_SEARCH_ENABLED=.*$', 'YAHOO_AUCTIONS_SEARCH_ENABLED=true'
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $ProjectRoot '.env'), $content, $utf8NoBom)
}

# Keys.txt is intentionally ignored by git. Load supported service keys only
# into the child compose process; never write them to tracked files or print them.
$keysPath = Join-Path $ProjectRoot 'Keys.txt'
function Read-CrawlerSecret(
  [string[]]$Labels,
  [string]$TokenPattern,
  [bool]$AllowUnlabeled = $true
) {
  if (-not (Test-Path -LiteralPath $keysPath)) { return $null }
  $values = @()
  foreach ($line in Get-Content -LiteralPath $keysPath) {
    $candidate = $line.Trim().Trim([char]34, [char]39)
    if ($AllowUnlabeled -and $candidate -match $TokenPattern) {
      $values += $candidate
    }
    foreach ($label in $Labels) {
      $labelPattern = [regex]::Escape($label)
      $match = [regex]::Match(
        $line,
        "^\s*$labelPattern\s*(?:[:=：]|\t)\s*(?<secret>\S+)\s*$",
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
      )
      if (-not $match.Success) { continue }
      $labeled = $match.Groups['secret'].Value.Trim().Trim([char]34, [char]39)
      if ($labeled -notmatch $TokenPattern) {
        throw "Keys.txt 中的 $label 不是可验证的对应平台凭据。"
      }
      $values += $labeled
    }
  }
  $uniqueValues = @($values | Select-Object -Unique)
  if ($uniqueValues.Count -gt 1) {
    throw "Keys.txt 中找到多个不同的 $($Labels[0])，无法安全判断应使用哪一个。"
  }
  if ($uniqueValues.Count -eq 0) { return $null }
  return $uniqueValues[0]
}

function Read-ValidatedEnvSecret([string]$Name, [string]$TokenPattern) {
  $value = Get-DotEnvValue $content $Name
  if (-not $value) { return $null }
  if ($value -notmatch $TokenPattern) {
    throw ".env 中的 $Name 不是可验证的对应平台凭据。"
  }
  return $value
}

function Read-ValidatedProcessSecret([string]$Name, [string]$TokenPattern) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { return $null }
  $value = $value.Trim().Trim([char]34, [char]39)
  if ($value -notmatch $TokenPattern) {
    throw "进程环境中的 $Name 不是可验证的对应平台凭据。"
  }
  return $value
}

$firecrawlPattern = '^fc-[A-Za-z0-9_-]{16,}$'
$apifyPattern = '^apify_api_[A-Za-z0-9_-]{16,}$'
$yahooShoppingPattern = '^[A-Za-z0-9._~-]{8,}$'
$firecrawlKey = Read-CrawlerSecret @('FIRECRAWL_API_KEY', 'Firecrawl API Key') $firecrawlPattern
if (-not $firecrawlKey) {
  $firecrawlKey = Read-ValidatedProcessSecret 'FIRECRAWL_API_KEY' $firecrawlPattern
}
if (-not $firecrawlKey) {
  $firecrawlKey = Read-ValidatedEnvSecret 'FIRECRAWL_API_KEY' $firecrawlPattern
}
$apifyKey = Read-CrawlerSecret @('APIFY_TOKEN', 'Apify API Token') $apifyPattern
if (-not $apifyKey) {
  $apifyKey = Read-ValidatedProcessSecret 'APIFY_TOKEN' $apifyPattern
}
if (-not $apifyKey) {
  $apifyKey = Read-ValidatedEnvSecret 'APIFY_TOKEN' $apifyPattern
}
$yahooShoppingClientId = Read-CrawlerSecret `
  @('YAHOO_SHOPPING_CLIENT_ID', 'Yahoo Shopping Client ID') `
  $yahooShoppingPattern `
  $false
if (-not $yahooShoppingClientId) {
  $yahooShoppingClientId = Read-ValidatedProcessSecret `
    'YAHOO_SHOPPING_CLIENT_ID' `
    $yahooShoppingPattern
}
if (-not $yahooShoppingClientId) {
  $yahooShoppingClientId = Read-ValidatedEnvSecret `
    'YAHOO_SHOPPING_CLIENT_ID' `
    $yahooShoppingPattern
}

if ($firecrawlKey) {
  $env:FIRECRAWL_API_KEY = $firecrawlKey
  $env:FIRECRAWL_DISCOVERY_ENABLED = 'true'
  $env:FIRECRAWL_ALLOW_ANY_DOMAIN = 'true'
} else {
  $env:FIRECRAWL_DISCOVERY_ENABLED = 'false'
}
if ($apifyKey) {
  $env:APIFY_TOKEN = $apifyKey
  $env:APIFY_ECOMMERCE_ENABLED = 'true'
} else {
  $env:APIFY_ECOMMERCE_ENABLED = 'false'
}
if ($yahooShoppingClientId) {
  $env:YAHOO_SHOPPING_CLIENT_ID = $yahooShoppingClientId
  $env:YAHOO_SHOPPING_SEARCH_ENABLED = 'true'
} else {
  $env:YAHOO_SHOPPING_SEARCH_ENABLED = 'false'
}
# Mandarake scheduled search remains disabled because its former public
# catalogue endpoint is unavailable; pasted public detail URLs still work.
$env:MANDARAKE_SEARCH_ENABLED = 'false'

if (-not (Get-DotEnvValue (Get-Content -Raw -LiteralPath $envPath) 'ZHIPU_API_KEY')) {
  Write-Host '未配置智谱密钥，网站仍可运行，AI 功能暂不可用。'
}

$composeArguments = @('compose', '--env-file', '.env')
if ($EnableAiGateway) {
  Write-Host 'AI 已改为智谱直连，沿用当前配置。'
}
$composeArguments += @('-f', 'infrastructure/docker-compose.yml')

function Invoke-Compose([string[]]$Arguments) {
  $allArguments = $composeArguments + $Arguments
  & docker @allArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose 命令失败：$($Arguments -join ' ')"
  }
}

function Wait-ComposeServiceHealthy(
  [string]$Service,
  [int]$TimeoutSeconds = 300
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    # Docker Desktop can briefly return a non-zero status while Compose is
    # replacing a container. Treat that hand-off window like a not-ready
    # state and retry instead of aborting an otherwise healthy deployment.
    $containerOutput = @(& docker @composeArguments 'ps' '-q' $Service 2>$null)
    $composeStatus = $LASTEXITCODE
    [string]$containerId = if ($containerOutput.Count -gt 0) {
      [string]$containerOutput[0]
    } else {
      ''
    }
    $containerId = $containerId.Trim()
    if ($composeStatus -ne 0) {
      Start-Sleep -Seconds 2
      continue
    }
    if ($containerId) {
      [string]$status = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $containerId
      $status = $status.Trim()
      if ($LASTEXITCODE -ne 0) { throw "无法检查 $Service 健康状态。" }
      if ($status -eq 'healthy') {
        Write-Host "$Service 已就绪。"
        return
      }
      if ($status -in @('exited', 'dead', 'unhealthy')) {
        throw "$Service 未能启动，当前状态：$status"
      }
    }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "等待 $Service 健康检查超时。"
}

# Build everything before replacing a running service. Keep the current web
# available while API migrations/startup finish, then switch web and worker.
Invoke-Compose @('build')
Invoke-Compose @('up', '-d', 'postgres', 'redis')
Invoke-Compose @('up', '-d', '--no-deps', 'api')
Wait-ComposeServiceHealthy 'api'
Invoke-Compose @('up', '-d', '--no-deps', 'web')
Wait-ComposeServiceHealthy 'web'
Invoke-Compose @('up', '-d', '--no-deps', 'worker')
Wait-ComposeServiceHealthy 'worker'
if (Get-DotEnvValue (Get-Content -Raw -LiteralPath $envPath) 'XIANYU_SESSION_TOKEN') {
  & "$PSScriptRoot\start-xianyu-bridge.ps1"
}

& "$PSScriptRoot\smoke.ps1"
