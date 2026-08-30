param(
  [string]$KeysPath = 'D:\tokusatsu-monitoring-platform\Keys.txt',
  [string]$EnvPath = 'D:\tokusatsu-monitoring-platform\.env',
  [switch]$RequireBai,
  [switch]$EnableVerifiedGroqFreeTier,
  [switch]$EnableCloudflareFreeAllocation
)

$ErrorActionPreference = 'Stop'

function Read-LabeledSecret([string]$Label) {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $labelPattern = [regex]::Escape($Label)
  $pattern = "^\s*$labelPattern\s*(?:[:=：]|\t)\s*(?<secret>\S.*?)\s*$"
  foreach ($line in Get-Content -LiteralPath $KeysPath) {
    $match = [regex]::Match($line, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { continue }
    $secret = $match.Groups['secret'].Value.Trim().Trim([char]34, [char]39)
    if ($secret) { return $secret }
  }
  return $null
}

function Read-OpenRouterSecret {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $content = Get-Content -Raw -LiteralPath $KeysPath
  # OpenRouter is the only intentionally unlabeled key. Match its full,
  # provider-specific prefix; never treat a generic sk-* value as OpenRouter.
  $matches = [regex]::Matches(
    $content,
    '(?<![A-Za-z0-9_-])sk-or-v1-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])'
  )
  $values = @($matches | ForEach-Object { $_.Value } | Select-Object -Unique)
  if ($values.Count -gt 1) {
    throw 'Keys.txt 中找到多个 OpenRouter key，无法安全判断应使用哪一个。'
  }
  if ($values.Count -eq 0) { return $null }
  return $values[0]
}

function Read-NvidiaSecret {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $content = Get-Content -Raw -LiteralPath $KeysPath
  # NVIDIA keys are intentionally detected by their provider-specific prefix.
  # Do not accept a generic key or use a nearby label as evidence.
  $matches = [regex]::Matches(
    $content,
    '(?<![A-Za-z0-9_-])nvapi-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])'
  )
  $values = @($matches | ForEach-Object { $_.Value } | Select-Object -Unique)
  if ($values.Count -gt 1) {
    throw 'Keys.txt 中找到多个 NVIDIA key，无法安全判断应使用哪一个。'
  }
  if ($values.Count -eq 0) { return $null }
  return $values[0]
}

function Read-SecretAfterConsoleUrl(
  [string]$Provider,
  [string]$UrlPattern,
  [string]$TokenPattern = ''
) {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $lines = @(Get-Content -LiteralPath $KeysPath)
  $values = @()
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if (-not [regex]::IsMatch(
        $lines[$index],
        $UrlPattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
      )) { continue }
    if ($index + 1 -ge $lines.Count) {
      throw "Keys.txt 中的 $Provider 官方控制台 URL 后缺少紧邻的 key 行。"
    }
    $candidate = $lines[$index + 1].Trim().Trim([char]34, [char]39)
    if (
      -not $candidate -or
      $candidate -match '\s' -or
      $candidate -match '(?i)^(?:[a-z][a-z0-9+.-]*://|www\.|\[.*\]\([a-z][a-z0-9+.-]*://)' -or
      $candidate -match '(?i)^(?:api\s*key|token|secret|account\s*id|密钥|令牌|账号)\s*[:=：]?$' -or
      ($TokenPattern -and -not [regex]::IsMatch($candidate, $TokenPattern))
    ) {
      throw "Keys.txt 中的 $Provider 官方控制台 URL 紧邻下一行不是安全的单值 key。"
    }
    $values += $candidate
  }
  $uniqueValues = @($values | Select-Object -Unique)
  if ($uniqueValues.Count -gt 1) {
    throw "Keys.txt 中找到多个不同的 $Provider key，无法安全判断应使用哪一个。"
  }
  if ($uniqueValues.Count -eq 0) { return $null }
  return $uniqueValues[0]
}

function Read-CloudflareAccountId {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $content = Get-Content -Raw -LiteralPath $KeysPath
  $matches = [regex]::Matches(
    $content,
    '(?i)(?<![A-Za-z0-9.-])https://dash\.cloudflare\.com/(?<account>[a-f0-9]{32})(?:[/#?]|$)'
  )
  $values = @(
    $matches |
      ForEach-Object { $_.Groups['account'].Value.ToLowerInvariant() } |
      Select-Object -Unique
  )
  if ($values.Count -gt 1) {
    throw 'Keys.txt 中找到多个不同的 Cloudflare Account ID，无法安全判断应使用哪一个。'
  }
  if ($values.Count -eq 0) { return $null }
  return $values[0]
}

function Set-EnvValue([string]$Content, [string]$Name, [string]$Value) {
  $pattern = "(?m)^$([regex]::Escape($Name))=.*(?:\r?\n|$)"
  $line = "$Name=$Value`r`n"
  if ($Content -match $pattern) { return $Content -replace $pattern, $line }
  if ($Content -and -not $Content.EndsWith("`n")) { $Content += "`r`n" }
  return $Content + $line
}

$baiKey = Read-LabeledSecret 'BAI AI API Key'
$geminiKey = Read-LabeledSecret 'Gemini'
$groqKey = Read-LabeledSecret 'groq'
$siliconFlowKey = Read-LabeledSecret 'SiliconFlow'
$nvidiaKey = Read-NvidiaSecret
$openRouterKey = Read-OpenRouterSecret
$cerebrasKey = Read-SecretAfterConsoleUrl `
  'Cerebras' `
  '(?i)(?<![A-Za-z0-9.-])https://cloud\.cerebras\.ai(?:[/#?][^\s\])>"'']*)?(?=$|[\s\])>"''])'
$cloudflareKey = Read-SecretAfterConsoleUrl `
  'Cloudflare' `
  '(?i)(?<![A-Za-z0-9.-])https://dash\.cloudflare\.com/[a-f0-9]{32}(?:[/#?][^\s\])>"'']*)?(?=$|[\s\])>"''])'
$cloudflareAccountId = Read-CloudflareAccountId
$cohereKey = Read-SecretAfterConsoleUrl `
  'Cohere' `
  '(?i)(?<![A-Za-z0-9.-])https://dashboard\.cohere\.com/api-keys(?:[/#?][^\s\])>"'']*)?(?=$|[\s\])>"''])'
$availableKeys = @(
  $baiKey,
  $geminiKey,
  $groqKey,
  $siliconFlowKey,
  $cerebrasKey,
  $cloudflareKey,
  $cohereKey,
  $nvidiaKey,
  $openRouterKey
) |
  Where-Object { $_ }
if ($availableKeys.Count -eq 0 -and $RequireBai) {
  throw 'Keys.txt 中未找到任何受支持的 AI API Key。未修改环境文件。'
}

$content = if (Test-Path -LiteralPath $EnvPath) {
  Get-Content -Raw -LiteralPath $EnvPath
} else {
  Get-Content -Raw -LiteralPath (Join-Path (Split-Path $EnvPath -Parent) '.env.example')
}

# Remove deprecated providers while preserving unrelated local configuration.
$content = $content -replace '(?im)^DEEPSEEK_[A-Z0-9_]*=.*(?:\r?\n|$)', ''
$content = $content -replace '(?im)^VISION_[A-Z0-9_]*=.*(?:\r?\n|$)', ''
if ($baiKey) {
  $content = Set-EnvValue $content 'BAI_API_KEY' $baiKey
}
if ($geminiKey) {
  $content = Set-EnvValue $content 'GEMINI_API_KEY' $geminiKey
}
if ($groqKey) {
  $content = Set-EnvValue $content 'GROQ_API_KEY' $groqKey
}
if ($siliconFlowKey) {
  $content = Set-EnvValue $content 'SILICONFLOW_API_KEY' $siliconFlowKey
}
if ($nvidiaKey) {
  $content = Set-EnvValue $content 'NVIDIA_API_KEY' $nvidiaKey
}
if ($openRouterKey) {
  $content = Set-EnvValue $content 'OPENROUTER_API_KEY' $openRouterKey
}
if ($cerebrasKey) {
  $content = Set-EnvValue $content 'CEREBRAS_API_KEY' $cerebrasKey
}
if ($cloudflareKey) {
  $content = Set-EnvValue $content 'CLOUDFLARE_AI_API_TOKEN' $cloudflareKey
}
if ($cloudflareAccountId) {
  $content = Set-EnvValue $content 'CLOUDFLARE_ACCOUNT_ID' $cloudflareAccountId
}
if ($cohereKey) {
  $content = Set-EnvValue $content 'COHERE_API_KEY' $cohereKey
}
$content = Set-EnvValue $content 'BAI_API_URL' 'https://api.b.ai/v1'
$content = Set-EnvValue $content 'GEMINI_API_URL' 'https://generativelanguage.googleapis.com/v1beta/openai'
$content = Set-EnvValue $content 'GEMINI_API_TIER' 'unknown'
$content = Set-EnvValue $content 'GROQ_API_URL' 'https://api.groq.com/openai/v1'
$content = Set-EnvValue $content 'GROQ_API_TIER' $(
  if ($EnableVerifiedGroqFreeTier) { 'free' } else { 'unknown' }
)
$content = Set-EnvValue $content 'SILICONFLOW_API_URL' 'https://api.siliconflow.cn/v1'
$content = Set-EnvValue $content 'SILICONFLOW_API_TIER' 'unknown'
$content = Set-EnvValue $content 'SILICONFLOW_FREE_MODELS' 'tencent/Hunyuan-MT-7B|Qwen/Qwen2.5-7B-Instruct'
$content = Set-EnvValue $content 'NVIDIA_API_URL' 'https://integrate.api.nvidia.com/v1'
$content = Set-EnvValue $content 'NVIDIA_API_TIER' 'unknown'
$content = Set-EnvValue $content 'NVIDIA_PRODUCTION_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'NVIDIA_INTERNAL_EVALUATION' 'false'
$content = Set-EnvValue $content 'NVIDIA_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'CEREBRAS_API_URL' 'https://api.cerebras.ai/v1'
$content = Set-EnvValue $content 'CEREBRAS_API_TIER' 'unknown'
$content = Set-EnvValue $content 'CEREBRAS_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'CLOUDFLARE_AI_API_URL' 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1'
$content = Set-EnvValue $content 'CLOUDFLARE_AI_API_TIER' $(
  if ($EnableCloudflareFreeAllocation) { 'free' } else { 'unknown' }
)
$content = Set-EnvValue $content 'CLOUDFLARE_AI_ALLOW_OVERAGE' 'false'
$content = Set-EnvValue $content 'CLOUDFLARE_AI_DAILY_NEURON_BUDGET' '8000'
$content = Set-EnvValue $content 'CLOUDFLARE_AI_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'COHERE_API_URL' 'https://api.cohere.ai/compatibility/v1'
$content = Set-EnvValue $content 'COHERE_API_TIER' 'unknown'
$content = Set-EnvValue $content 'COHERE_INTERNAL_EVALUATION' 'false'
$content = Set-EnvValue $content 'COHERE_PRODUCTION_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'COHERE_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'OPENROUTER_API_URL' 'https://openrouter.ai/api/v1'
$content = Set-EnvValue $content 'OPENROUTER_APP_NAME' 'Kamen Procurement'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER' 'bai|gemini|groq|siliconflow|cerebras|cloudflare|cohere|nvidia|openrouter'
$content = Set-EnvValue $content 'AI_COST_POLICY' 'free_only'
$content = Set-EnvValue $content 'AI_ALLOW_PAID_MODELS' 'false'
$content = Set-EnvValue $content 'AI_CATALOG_REFRESH_INTERVAL_MS' '21600000'
$content = Set-EnvValue $content 'AI_CATALOG_NEGATIVE_CACHE_MS' '60000'
$content = Set-EnvValue $content 'AI_CATALOG_TIMEOUT_MS' '5000'
$content = Set-EnvValue $content 'AI_PRICING_VERIFICATION_MAX_AGE_MS' '86400000'
$content = Set-EnvValue $content 'AI_PROVIDER_CIRCUIT_COOLDOWN_MS' '60000'
$content = Set-EnvValue $content 'AI_TIMEOUT_MS' '30000'
$content = Set-EnvValue $content 'AI_MODEL_TIMEOUT_MS' '30000'
$content = Set-EnvValue $content 'AI_GATEWAY_DEADLINE_MS' '240000'
$content = Set-EnvValue $content 'AI_GATEWAY_CLIENT_TIMEOUT_MS' '270000'
$content = Set-EnvValue $content 'AI_PROXY_TIMEOUT_MS' '270000'
$content = Set-EnvValue $content 'AI_HTTP_RETRIES' '1'
$content = Set-EnvValue $content 'AI_CHAT_PLANNER_ENABLED' 'false'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_BULK_FILTER' 'groq|cerebras|cloudflare|gemini|siliconflow|bai|nvidia|cohere|openrouter'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_TRANSLATION' 'gemini|cloudflare|siliconflow|cerebras|nvidia|bai|groq|cohere|openrouter'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_CLASSIFICATION' 'groq|cerebras|cloudflare|gemini|siliconflow|bai|nvidia|cohere|openrouter'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_IMAGE_ANALYSIS' 'gemini|bai|cloudflare|cohere|cerebras|siliconflow|groq|openrouter'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_SELLER_ANALYSIS' 'gemini|groq|cloudflare|cerebras|nvidia|bai|siliconflow|cohere|openrouter'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_COMPLEX_ANALYSIS' 'gemini|groq|cerebras|cloudflare|nvidia|bai|cohere|openrouter|siliconflow'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_CROSS_VALIDATION' 'gemini|groq|cerebras|cloudflare|nvidia|bai|cohere|siliconflow|openrouter'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_MARKET_ANALYSIS' 'groq|gemini|cloudflare|cerebras|nvidia|bai|cohere|openrouter|siliconflow'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_CRAWLER_DIAGNOSIS' 'gemini|groq|cerebras|cloudflare|nvidia|bai|cohere|openrouter|siliconflow'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_LOGISTICS_ANALYSIS' 'gemini|cloudflare|cerebras|nvidia|bai|groq|siliconflow|cohere|openrouter'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_ASSISTANT_CHAT' 'groq|cloudflare|cerebras|gemini|nvidia|bai|cohere|siliconflow|openrouter'
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
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_BULK_FILTER' 'gemini-3.5-flash-lite|gemini-flash-lite-latest|gemini-3.7-flash'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_TRANSLATION' 'gemini-3.5-flash-lite|gemini-flash-lite-latest|gemini-3.7-flash'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_CLASSIFICATION' 'gemini-3.5-flash-lite|gemini-flash-lite-latest|gemini-3.7-flash'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_IMAGE_ANALYSIS' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_SELLER_ANALYSIS' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_COMPLEX_ANALYSIS' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_CROSS_VALIDATION' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_MARKET_ANALYSIS' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_CRAWLER_DIAGNOSIS' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_LOGISTICS_ANALYSIS' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_ASSISTANT_CHAT' 'gemini-3.7-flash|gemini-3.5-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_BULK_FILTER' 'openai/gpt-oss-20b|openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_TRANSLATION' 'openai/gpt-oss-20b|qwen/qwen3.8-27b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_CLASSIFICATION' 'openai/gpt-oss-20b|openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_IMAGE_ANALYSIS' 'qwen/qwen3.8-27b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_SELLER_ANALYSIS' 'groq/compound|openai/gpt-oss-120b|openai/gpt-oss-20b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_COMPLEX_ANALYSIS' 'openai/gpt-oss-120b|groq/compound|openai/gpt-oss-20b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_CROSS_VALIDATION' 'openai/gpt-oss-120b|openai/gpt-oss-20b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_MARKET_ANALYSIS' 'groq/compound|openai/gpt-oss-120b|openai/gpt-oss-20b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_CRAWLER_DIAGNOSIS' 'openai/gpt-oss-120b|groq/compound|openai/gpt-oss-20b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_LOGISTICS_ANALYSIS' 'openai/gpt-oss-20b|openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_GROQ_ASSISTANT_CHAT' 'openai/gpt-oss-20b|openai/gpt-oss-120b|groq/compound'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_BULK_FILTER' 'Qwen/Qwen2.5-7B-Instruct|deepseek-ai/DeepSeek-V4-Flash'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_TRANSLATION' 'tencent/Hunyuan-MT-7B|Qwen/Qwen2.5-7B-Instruct|deepseek-ai/DeepSeek-V4-Flash'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_CLASSIFICATION' 'Qwen/Qwen2.5-7B-Instruct|deepseek-ai/DeepSeek-V4-Flash'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_IMAGE_ANALYSIS' 'Qwen/Qwen3-VL-8B-Instruct'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_SELLER_ANALYSIS' 'deepseek-ai/DeepSeek-V4-Flash|Qwen/Qwen3-Coder-30B-A3B-Instruct|Qwen/Qwen2.5-7B-Instruct'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_COMPLEX_ANALYSIS' 'Qwen/Qwen3-Coder-30B-A3B-Instruct|deepseek-ai/DeepSeek-V4-Flash|Qwen/Qwen2.5-7B-Instruct'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_CROSS_VALIDATION' 'deepseek-ai/DeepSeek-V4-Flash|Qwen/Qwen2.5-7B-Instruct'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_MARKET_ANALYSIS' 'deepseek-ai/DeepSeek-V4-Flash|Qwen/Qwen3-Coder-30B-A3B-Instruct|Qwen/Qwen2.5-7B-Instruct'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_CRAWLER_DIAGNOSIS' 'Qwen/Qwen3-Coder-30B-A3B-Instruct|deepseek-ai/DeepSeek-V4-Flash|Qwen/Qwen2.5-7B-Instruct'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_LOGISTICS_ANALYSIS' 'Qwen/Qwen2.5-7B-Instruct|deepseek-ai/DeepSeek-V4-Flash'
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_ASSISTANT_CHAT' 'deepseek-ai/DeepSeek-V4-Flash|Qwen/Qwen2.5-7B-Instruct|Qwen/Qwen3-Coder-30B-A3B-Instruct'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_BULK_FILTER' 'gemma-4-31b|gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_TRANSLATION' 'gemma-4-31b|gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_CLASSIFICATION' 'gemma-4-31b|gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_IMAGE_ANALYSIS' ''
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_SELLER_ANALYSIS' 'gpt-oss-120b|gemma-4-31b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_COMPLEX_ANALYSIS' 'gpt-oss-120b|gemma-4-31b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_CROSS_VALIDATION' 'gpt-oss-120b|gemma-4-31b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_MARKET_ANALYSIS' 'gpt-oss-120b|gemma-4-31b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_CRAWLER_DIAGNOSIS' 'gpt-oss-120b|gemma-4-31b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_LOGISTICS_ANALYSIS' 'gemma-4-31b|gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_ASSISTANT_CHAT' 'gpt-oss-120b|gemma-4-31b'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_BULK_FILTER' '@cf/google/gemma-4-26b-a4b-it|@cf/zai-org/glm-4.7-flash|@cf/openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_TRANSLATION' '@cf/zai-org/glm-4.7-flash|@cf/google/gemma-4-26b-a4b-it|@cf/openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_CLASSIFICATION' '@cf/google/gemma-4-26b-a4b-it|@cf/zai-org/glm-4.7-flash|@cf/openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_IMAGE_ANALYSIS' '@cf/meta/llama-3.2-11b-vision-instruct'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_SELLER_ANALYSIS' '@cf/zai-org/glm-4.7-flash|@cf/nvidia/nemotron-3-120b-a12b|@cf/openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_COMPLEX_ANALYSIS' '@cf/nvidia/nemotron-3-120b-a12b|@cf/openai/gpt-oss-120b|@cf/zai-org/glm-4.7-flash'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_CROSS_VALIDATION' '@cf/nvidia/nemotron-3-120b-a12b|@cf/openai/gpt-oss-120b|@cf/zai-org/glm-4.7-flash'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_MARKET_ANALYSIS' '@cf/nvidia/nemotron-3-120b-a12b|@cf/zai-org/glm-4.7-flash|@cf/openai/gpt-oss-120b'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_CRAWLER_DIAGNOSIS' '@cf/openai/gpt-oss-120b|@cf/nvidia/nemotron-3-120b-a12b|@cf/zai-org/glm-4.7-flash'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_LOGISTICS_ANALYSIS' '@cf/zai-org/glm-4.7-flash|@cf/google/gemma-4-26b-a4b-it'
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_ASSISTANT_CHAT' '@cf/zai-org/glm-4.7-flash|@cf/google/gemma-4-26b-a4b-it|@cf/nvidia/nemotron-3-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_BULK_FILTER' 'command-a-plus-05-2026|command-a-reasoning-08-2025'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_TRANSLATION' 'command-a-translate-08-2025|command-a-plus-05-2026'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_CLASSIFICATION' 'command-a-plus-05-2026|command-a-reasoning-08-2025'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_IMAGE_ANALYSIS' 'command-a-plus-05-2026'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_SELLER_ANALYSIS' 'command-a-plus-05-2026|command-a-reasoning-08-2025'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_COMPLEX_ANALYSIS' 'command-a-reasoning-08-2025|command-a-plus-05-2026'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_CROSS_VALIDATION' 'command-a-reasoning-08-2025|command-a-plus-05-2026'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_MARKET_ANALYSIS' 'command-a-reasoning-08-2025|command-a-plus-05-2026'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_CRAWLER_DIAGNOSIS' 'command-a-reasoning-08-2025|command-a-plus-05-2026'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_LOGISTICS_ANALYSIS' 'command-a-plus-05-2026|command-a-reasoning-08-2025'
$content = Set-EnvValue $content 'AI_ROUTE_COHERE_ASSISTANT_CHAT' 'command-a-plus-05-2026|command-a-reasoning-08-2025'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_BULK_FILTER' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_TRANSLATION' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_CLASSIFICATION' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_IMAGE_ANALYSIS' ''
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_SELLER_ANALYSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_COMPLEX_ANALYSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_CROSS_VALIDATION' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_MARKET_ANALYSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_CRAWLER_DIAGNOSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_LOGISTICS_ANALYSIS' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_ASSISTANT_CHAT' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_BULK_FILTER' 'deepseek/deepseek-v4-flash|z-ai/glm-5.2:free|minimax/minimax-m3:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_TRANSLATION' 'deepseek/deepseek-v4-flash|z-ai/glm-5.2:free|minimax/minimax-m3:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_CLASSIFICATION' 'deepseek/deepseek-v4-flash|z-ai/glm-5.2:free|minimax/minimax-m3:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_IMAGE_ANALYSIS' 'deepseek/deepseek-v4-flash-vision-exp|minimax/minimax-m3:free|z-ai/glm-5.2:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_SELLER_ANALYSIS' 'deepseek/deepseek-v4-flash|z-ai/glm-5.2:free|minimax/minimax-m3:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_COMPLEX_ANALYSIS' 'deepseek/deepseek-v4-flash|nvidia/nemotron-3-ultra-550b-a55b:free|minimax/minimax-m3:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_CROSS_VALIDATION' 'deepseek/deepseek-v4-flash|nvidia/nemotron-3-ultra-550b-a55b:free|minimax/minimax-m3:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_MARKET_ANALYSIS' 'deepseek/deepseek-v4-flash|nvidia/nemotron-3-ultra-550b-a55b:free|z-ai/glm-5.2:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_CRAWLER_DIAGNOSIS' 'qwen/qwen3-coder|nvidia/nemotron-3-ultra-550b-a55b:free|z-ai/glm-5.2:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_LOGISTICS_ANALYSIS' 'deepseek/deepseek-v4-flash|z-ai/glm-5.2:free|minimax/minimax-m3:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_ASSISTANT_CHAT' 'deepseek/deepseek-v4-flash|z-ai/glm-5.2:free|minimax/minimax-m3:free'

if ($content -notmatch '(?m)^AI_INTERNAL_TOKEN=\S+') {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $content = Set-EnvValue $content 'AI_INTERNAL_TOKEN' $token
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($EnvPath, $content, $utf8NoBom)
Write-Host ("AI Provider 配置已安全同步；credentials_complete={0}；未输出任何密钥。" -f ($availableKeys.Count -eq 9))
