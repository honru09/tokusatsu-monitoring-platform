param(
  [string]$KeysPath = 'D:\tokusatsu-monitoring-platform\Keys.txt',
  [string]$EnvPath = 'D:\tokusatsu-monitoring-platform\.env',
  [switch]$RequireBai
)

$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Pattern) {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $line = Get-Content -LiteralPath $KeysPath | Where-Object {
    $_ -match $Pattern
  } | Select-Object -First 1
  if (-not $line) { return $null }
  # Keys.txt may use either ASCII or full-width punctuation (：). Keep only
  # the final token so labels such as “BAI AI API Key：” never enter the secret.
  $parts = $line.Trim() -split '[\t :=：]+'
  if ($parts.Count -lt 2) { return $null }
  return $parts[-1].Trim().Trim([char]34, [char]39)
}

function Set-EnvValue([string]$Content, [string]$Name, [string]$Value) {
  $pattern = "(?m)^$([regex]::Escape($Name))=.*(?:\r?\n|$)"
  $line = "$Name=$Value`r`n"
  if ($Content -match $pattern) { return $Content -replace $pattern, $line }
  if ($Content -and -not $Content.EndsWith("`n")) { $Content += "`r`n" }
  return $Content + $line
}

$baiKey = Read-Secret '(?i)b\.?\s*ai'
if (-not $baiKey -and $RequireBai) {
  throw 'Keys.txt 中未找到 B.AI API Key。未修改环境文件。'
}

$content = if (Test-Path -LiteralPath $EnvPath) {
  Get-Content -Raw -LiteralPath $EnvPath
} else {
  Get-Content -Raw -LiteralPath (Join-Path (Split-Path $EnvPath -Parent) '.env.example')
}

# Remove deprecated providers while preserving unrelated local configuration.
$content = $content -replace '(?im)^DEEPSEEK_[A-Z0-9_]*=.*(?:\r?\n|$)', ''
$content = $content -replace '(?im)^VISION_[A-Z0-9_]*=.*(?:\r?\n|$)', ''
$content = $content -replace '(?im)^OPENROUTER_[A-Z0-9_]*=.*(?:\r?\n|$)', ''
if ($baiKey) {
  $content = Set-EnvValue $content 'BAI_API_KEY' $baiKey
}
$content = Set-EnvValue $content 'BAI_API_URL' 'https://api.b.ai/v1'
$content = Set-EnvValue $content 'AI_TIMEOUT_MS' '120000'
$content = Set-EnvValue $content 'AI_ROUTE_BULK_FILTER' 'mimo-v2.5|deepseek-v4-flash|glm-5.3-flash'
$content = Set-EnvValue $content 'AI_ROUTE_TRANSLATION' 'mimo-v2.5|deepseek-v4-flash|glm-5.3-flash'
$content = Set-EnvValue $content 'AI_ROUTE_CLASSIFICATION' 'mimo-v2.5|deepseek-v4-flash|glm-5.3-flash'
$content = Set-EnvValue $content 'AI_ROUTE_IMAGE_ANALYSIS' 'deepseek-v4-flash-vision-exp|mimo-v2.5|glm-5.3-flash'
$content = Set-EnvValue $content 'AI_ROUTE_SELLER_ANALYSIS' 'mimo-v2.5|deepseek-v4-flash|glm-5.3-flash'
$content = Set-EnvValue $content 'AI_ROUTE_COMPLEX_ANALYSIS' 'glm-5.3-flash|qwen3.8-flash|mimo-v2.5'
$content = Set-EnvValue $content 'AI_ROUTE_CROSS_VALIDATION' 'glm-5.3-flash|qwen3.8-flash|mimo-v2.5'
$content = Set-EnvValue $content 'AI_ROUTE_MARKET_ANALYSIS' 'glm-5.3-flash|qwen3.8-flash|mimo-v2.5'
$content = Set-EnvValue $content 'AI_ROUTE_CRAWLER_DIAGNOSIS' 'hy3|glm-5.3-flash|qwen3.8-flash'
$content = Set-EnvValue $content 'AI_ROUTE_LOGISTICS_ANALYSIS' 'mimo-v2.5|glm-5.3-flash|deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_ASSISTANT_CHAT' 'glm-5.3-flash|qwen3.8-flash|mimo-v2.5'

if ($content -notmatch '(?m)^AI_INTERNAL_TOKEN=\S+') {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $content = Set-EnvValue $content 'AI_INTERNAL_TOKEN' $token
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($EnvPath, $content, $utf8NoBom)
Write-Host 'B.AI 密钥与六模型白名单已安全同步；旧 Provider 配置已移除。'
