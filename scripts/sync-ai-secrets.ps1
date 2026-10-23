param(
  [string]$KeysPath = 'D:\tokusatsu-monitoring-platform\Keys.txt',
  [string]$EnvPath = 'D:\tokusatsu-monitoring-platform\.env',
  [switch]$RequireBai,
  [switch]$RequireOvo,
  [switch]$EnableVerifiedGeminiFreeTier,
  [switch]$EnableVerifiedGroqFreeTier,
  [Alias('EnableVerifiedCerebrasFreeTier')]
  [switch]$EnableVerifiedCerebrasFreeTrial,
  [switch]$EnableCloudflareFreeAllocation
)

$ErrorActionPreference = 'Stop'

function Read-LabeledSecret([string]$Label) {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $labelPattern = [regex]::Escape($Label)
  $pattern = "^\s*$labelPattern\s*(?:[:=：]|\t)\s*(?<secret>\S.*?)\s*$"
  $values = @()
  foreach ($line in Get-Content -LiteralPath $KeysPath) {
    $match = [regex]::Match($line, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { continue }
    $secret = $match.Groups['secret'].Value.Trim().Trim([char]34, [char]39)
    if ($secret) { $values += $secret }
  }
  $uniqueValues = @($values | Select-Object -Unique)
  if ($uniqueValues.Count -gt 1) {
    throw "Keys.txt 中找到多个不同的 $Label key，无法安全判断应使用哪一个。"
  }
  if ($uniqueValues.Count -eq 0) { return $null }
  return $uniqueValues[0]
}

function Read-OpenRouterSecret {
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $null }
  $content = [string](Get-Content -Raw -LiteralPath $KeysPath)
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
  $content = [string](Get-Content -Raw -LiteralPath $KeysPath)
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
  $content = [string](Get-Content -Raw -LiteralPath $KeysPath)
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

function Read-SenseNovaSecrets {
  $result = @{ Main = $null; Translate = $null; Secondary = $null }
  $keyPattern = '^sk-[A-Za-z0-9_-]{10,}$'
  if (-not (Test-Path -LiteralPath $KeysPath)) { return $result }
  $lines = @(Get-Content -LiteralPath $KeysPath)
  $anchorIndexes = @()
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match '(?i)https://platform\.sensenova\.cn(?:[/#?]|$)') {
      $anchorIndexes += $index
    }
  }
  if ($anchorIndexes.Count -gt 2) {
    throw 'Keys.txt 中找到超过两个 SenseNova 控制台区块，无法安全判断凭据归属。'
  }
  if ($anchorIndexes.Count -eq 0) { return $result }

  for ($blockIndex = 0; $blockIndex -lt $anchorIndexes.Count; $blockIndex++) {
    $anchor = $anchorIndexes[$blockIndex]
    $end = [Math]::Min($lines.Count - 1, $anchor + 8)
    if ($blockIndex + 1 -lt $anchorIndexes.Count) {
      $end = [Math]::Min($end, $anchorIndexes[$blockIndex + 1] - 1)
    }
    if ($anchor + 1 -gt $end) { continue }

    $index = $anchor + 1
    while ($index -le $end) {
      $sourceLabel = $lines[$index].Trim().TrimEnd(':', '=', '：')
      if ($sourceLabel -notin @('Main', 'Translate', 'Secondary')) {
        if (
          $lines[$index].Trim().Trim([char]34, [char]39) -match $keyPattern
        ) {
          throw 'Keys.txt 的 SenseNova 控制台区块中存在未标记的额外 key。'
        }
        if (
          $index + 1 -le $end -and
          $lines[$index + 1].Trim().Trim([char]34, [char]39) -match $keyPattern
        ) {
          throw "Keys.txt 的 SenseNova 控制台区块中存在未知标签 $sourceLabel。"
        }
        $index++
        continue
      }
      if ($index + 1 -gt $end) {
        throw "Keys.txt 的 SenseNova $sourceLabel 标签后缺少 key。"
      }
      if ($blockIndex -eq 1 -and $sourceLabel -eq 'Translate') {
        throw 'Keys.txt 的第二个 SenseNova 账号区块不支持 Translate 标签。'
      }
      $targetLabel = if (
        $sourceLabel -eq 'Secondary' -or
        ($blockIndex -eq 1 -and $sourceLabel -eq 'Main')
      ) { 'Secondary' } else { $sourceLabel }
      $candidate = $lines[$index + 1].Trim().Trim([char]34, [char]39)
      if ($candidate -notmatch $keyPattern) {
        throw "Keys.txt 的 SenseNova $sourceLabel 标签下一行不是有效的单值 key。"
      }
      if ($result[$targetLabel] -and $result[$targetLabel] -ne $candidate) {
        throw "Keys.txt 中找到多个不同的 SenseNova $targetLabel key。"
      }
      $result[$targetLabel] = $candidate
      $index += 2
    }
  }
  return $result
}

function Set-EnvValue([string]$Content, [string]$Name, [string]$Value) {
  $pattern = "(?m)^$([regex]::Escape($Name))=.*(?:\r?\n|$)"
  $line = "$Name=$Value`r`n"
  if ($Content -match $pattern) { return $Content -replace $pattern, $line }
  if ($Content -and -not $Content.EndsWith("`n")) { $Content += "`r`n" }
  return $Content + $line
}

function Set-EnvDefault([string]$Content, [string]$Name, [string]$Value) {
  if ($Content -match "(?m)^$([regex]::Escape($Name))=") { return $Content }
  return Set-EnvValue $Content $Name $Value
}

function Read-EnvValue([string]$Content, [string]$Name) {
  $match = [regex]::Match(
    $Content,
    "(?m)^$([regex]::Escape($Name))=(?<value>.*)$"
  )
  if (-not $match.Success) { return $null }
  $value = $match.Groups['value'].Value.Trim().Trim([char]34, [char]39)
  if (-not $value) { return $null }
  return $value
}

function Set-EnvValueIfEmpty([string]$Content, [string]$Name, [string]$Value) {
  if (Read-EnvValue $Content $Name) { return $Content }
  return Set-EnvValue $Content $Name $Value
}

function Test-OvoEndpoint([string]$Value) {
  if (-not $Value) { return $false }
  try {
    $uri = [Uri]$Value
    return (
      $uri.Scheme -eq 'https' -and
      $uri.Host -eq 'ovo1.cn' -and
      -not $uri.UserInfo -and
      -not $uri.Query -and
      -not $uri.Fragment
    )
  } catch {
    return $false
  }
}

$baiKey = Read-LabeledSecret 'BAI AI API Key'
$ovoLabeledKey = Read-LabeledSecret 'OVO API Key'
$ovoConsoleKey = Read-SecretAfterConsoleUrl `
  'OVO' `
  '(?i)(?<![A-Za-z0-9.-])https://ovo1\.cn/?(?=$|[\s\])>"''])' `
  '^sk-[A-Za-z0-9_-]{20,}$'
if (
  $ovoLabeledKey -and
  $ovoConsoleKey -and
  $ovoLabeledKey -ne $ovoConsoleKey
) {
  throw 'Keys.txt 中显式 OVO API Key 与 OVO 控制台 URL 紧邻 key 不一致，无法安全判断应使用哪一个。'
}
$ovoKey = if ($ovoLabeledKey) { $ovoLabeledKey } else { $ovoConsoleKey }
$geminiKey = Read-LabeledSecret 'Gemini'
$groqKey = Read-LabeledSecret 'groq'
$siliconFlowKey = Read-LabeledSecret 'SiliconFlow'
$nvidiaKey = Read-NvidiaSecret
$openRouterKey = Read-OpenRouterSecret
$openAiKey = Read-LabeledSecret 'OpenAI'
$anthropicKey = Read-LabeledSecret 'Anthropic'
$deepSeekKey = Read-LabeledSecret 'DeepSeek'
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
$senseNovaSecrets = if ($RequireOvo) {
  # Production deployment is intentionally OVO-only. Optional, paused provider
  # formats must not prevent the required OVO credential from being installed;
  # their existing environment values remain untouched.
  @{ Main = $null; Translate = $null; Secondary = $null }
} else {
  Read-SenseNovaSecrets
}
$senseNovaMainKey = $senseNovaSecrets.Main
$senseNovaTranslationKey = $senseNovaSecrets.Translate
$senseNovaSecondaryKey = $senseNovaSecrets.Secondary
$availableKeys = @(
  @(
    $baiKey,
    $ovoKey,
    $geminiKey,
    $groqKey,
    $siliconFlowKey,
    $cerebrasKey,
    $cloudflareKey,
    $cohereKey,
    $nvidiaKey,
    $senseNovaMainKey,
    $senseNovaTranslationKey,
    $senseNovaSecondaryKey,
    $openRouterKey,
    $openAiKey,
    $anthropicKey,
    $deepSeekKey
  ) | Where-Object { $_ }
)
if ($availableKeys.Count -eq 0 -and $RequireBai) {
  throw 'Keys.txt 中未找到任何受支持的 AI API Key。未修改环境文件。'
}

$content = if (Test-Path -LiteralPath $EnvPath) {
  Get-Content -Raw -LiteralPath $EnvPath
} else {
  Get-Content -Raw -LiteralPath (Join-Path (Split-Path $EnvPath -Parent) '.env.example')
}

# Preserve unrelated and upstream-only credentials. In particular,
# DEEPSEEK_API_KEY is consumed by LiteLLM and must never be removed here.
if ($baiKey) {
  $content = Set-EnvValue $content 'BAI_API_KEY' $baiKey
}
if ($ovoKey) {
  $content = Set-EnvValue $content 'OVO_API_KEY' $ovoKey
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
if ($openAiKey) {
  $content = Set-EnvValue $content 'OPENAI_API_KEY' $openAiKey
}
if ($anthropicKey) {
  $content = Set-EnvValue $content 'ANTHROPIC_API_KEY' $anthropicKey
}
if ($deepSeekKey) {
  $content = Set-EnvValue $content 'DEEPSEEK_API_KEY' $deepSeekKey
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
if ($senseNovaMainKey) {
  $content = Set-EnvValue $content 'SENSENOVA_API_KEY' $senseNovaMainKey
}
if ($senseNovaTranslationKey) {
  $content = Set-EnvValue $content 'SENSENOVA_TRANSLATION_API_KEY' $senseNovaTranslationKey
}
if ($senseNovaSecondaryKey) {
  $content = Set-EnvValueIfEmpty $content 'SENSENOVA_SECONDARY_API_KEY' $senseNovaSecondaryKey
}
$content = Set-EnvValueIfEmpty $content 'BAI_API_URL' 'https://api.b.ai/v1'
$content = Set-EnvValueIfEmpty $content 'BAI_API_TIER' 'unknown'
$content = Set-EnvValueIfEmpty $content 'BAI_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'BAI_PRICING_VERIFIED_AT' ''
$content = Set-EnvValue $content 'BAI_INTERNAL_EVALUATION' 'false'
$content = Set-EnvValue $content 'BAI_PRODUCTION_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'BAI_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'BAI_PROMOTIONS_URL' 'https://docs.b.ai/llmservice/promotions-and-pricing-notices/'
$content = Set-EnvValueIfEmpty $content 'GEMINI_API_URL' 'https://generativelanguage.googleapis.com/v1beta/openai'
$content = Set-EnvValue $content 'GEMINI_MODEL' 'gemini-3.1-flash-lite'
$content = if ($EnableVerifiedGeminiFreeTier) {
  Set-EnvValue $content 'GEMINI_API_TIER' 'free'
} else {
  Set-EnvValueIfEmpty $content 'GEMINI_API_TIER' 'unknown'
}
$content = Set-EnvValueIfEmpty $content 'GEMINI_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'GEMINI_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'GEMINI_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'GEMINI_PRICING_VERIFIED_AT' ''
$content = Set-EnvValueIfEmpty $content 'GEMINI_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'GROQ_API_URL' 'https://api.groq.com/openai/v1'
$content = if ($EnableVerifiedGroqFreeTier) {
  Set-EnvValue $content 'GROQ_API_TIER' 'free'
} else {
  Set-EnvValueIfEmpty $content 'GROQ_API_TIER' 'unknown'
}
$content = Set-EnvValueIfEmpty $content 'GROQ_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'GROQ_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'GROQ_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'GROQ_PRICING_VERIFIED_AT' ''
$content = Set-EnvValueIfEmpty $content 'GROQ_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'SILICONFLOW_API_URL' 'https://api.siliconflow.cn/v1'
$content = Set-EnvValueIfEmpty $content 'SILICONFLOW_API_TIER' 'unknown'
$content = Set-EnvValueIfEmpty $content 'SILICONFLOW_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'SILICONFLOW_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'SILICONFLOW_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'SILICONFLOW_PRICING_VERIFIED_AT' ''
$content = Set-EnvValue $content 'SILICONFLOW_INTERNAL_EVALUATION' 'false'
$content = Set-EnvValue $content 'SILICONFLOW_PRODUCTION_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'SILICONFLOW_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'NVIDIA_API_URL' 'https://integrate.api.nvidia.com/v1'
$content = Set-EnvValueIfEmpty $content 'NVIDIA_API_TIER' 'unknown'
$content = Set-EnvValue $content 'NVIDIA_PRODUCTION_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'NVIDIA_INTERNAL_EVALUATION' 'false'
$content = Set-EnvDefault $content 'NVIDIA_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'CEREBRAS_API_URL' 'https://api.cerebras.ai/v1'
$content = if ($EnableVerifiedCerebrasFreeTrial) {
  # Cerebras grants expiring trial credits, not a renewable free tier.
  Set-EnvValue $content 'CEREBRAS_API_TIER' 'promotion'
} else {
  Set-EnvValueIfEmpty $content 'CEREBRAS_API_TIER' 'unknown'
}
$content = Set-EnvValueIfEmpty $content 'CEREBRAS_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'CEREBRAS_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'CEREBRAS_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'CEREBRAS_PRICING_VERIFIED_AT' ''
$content = Set-EnvValueIfEmpty $content 'CEREBRAS_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_API_URL' 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1'
$content = if ($EnableCloudflareFreeAllocation) {
  Set-EnvValue $content 'CLOUDFLARE_AI_API_TIER' 'free'
} else {
  Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_API_TIER' 'unknown'
}
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_PRICING_VERIFIED_AT' ''
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_ALLOW_OVERAGE' 'false'
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_DAILY_NEURON_BUDGET' '8000'
$content = Set-EnvValueIfEmpty $content 'CLOUDFLARE_AI_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'COHERE_API_URL' 'https://api.cohere.ai/compatibility/v1'
$content = Set-EnvValueIfEmpty $content 'COHERE_API_TIER' 'unknown'
$content = Set-EnvValueIfEmpty $content 'COHERE_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'COHERE_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'COHERE_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'COHERE_PRICING_VERIFIED_AT' ''
$content = Set-EnvValue $content 'COHERE_INTERNAL_EVALUATION' 'false'
$content = Set-EnvValue $content 'COHERE_PRODUCTION_AUTHORIZED' 'false'
$content = Set-EnvDefault $content 'COHERE_PRIVATE_DATA_AUTHORIZED' 'false'
$senseNovaUrl = Read-EnvValue $content 'SENSENOVA_API_URL'
if (-not $senseNovaUrl -or $senseNovaUrl -eq 'https://api.sensenova.cn/compatible-mode/v2') {
  $content = Set-EnvValue $content 'SENSENOVA_API_URL' 'https://token.sensenova.cn/v1'
}
$content = Set-EnvValueIfEmpty $content 'SENSENOVA_API_TIER' 'unknown'
$content = Set-EnvValueIfEmpty $content 'SENSENOVA_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'SENSENOVA_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'SENSENOVA_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'SENSENOVA_PRICING_VERIFIED_AT' ''
$content = Set-EnvValue $content 'SENSENOVA_INTERNAL_EVALUATION' 'false'
$content = Set-EnvValue $content 'SENSENOVA_PRODUCTION_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'SENSENOVA_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_API_URL' 'https://openrouter.ai/api/v1'
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_APP_NAME' 'Kamen Procurement'
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_API_TIER' 'unknown'
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_FREE_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_PROMOTION_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_PAID_MODELS' ''
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_PRICING_VERIFIED_AT' ''
$content = Set-EnvValueIfEmpty $content 'OPENROUTER_PRIVATE_DATA_AUTHORIZED' 'false'

$content = Set-EnvValueIfEmpty $content 'OVO_API_URL' 'https://ovo1.cn/v1'
$content = Set-EnvValue $content 'OVO_API_TIER' 'paid'
$content = Set-EnvValue $content 'OVO_INTERNAL_EVALUATION' 'true'
$content = Set-EnvValue $content 'OVO_PRODUCTION_AUTHORIZED' 'true'
$content = Set-EnvValue $content 'OVO_PRIVATE_DATA_AUTHORIZED' 'false'
$content = Set-EnvValue $content 'AI_PROVIDER_MAX_CONCURRENCY_OVO' '1'
$content = Set-EnvValue $content 'AI_PROVIDER_MAX_CONCURRENCY_GEMINI' '3'
$content = Set-EnvValue $content 'AI_PROVIDER_RPM_GEMINI' '12'

$ovoConfigured = [bool](Read-EnvValue $content 'OVO_API_KEY')
$legacyOvoConfigured = [bool](
  (Read-EnvValue $content 'BAI_API_KEY') -and
  (Test-OvoEndpoint (Read-EnvValue $content 'BAI_API_URL'))
)
if ($RequireOvo -and -not ($ovoConfigured -or $legacyOvoConfigured)) {
  throw '未找到 OVO 凭据。请设置 OVO_API_KEY，或保留现有 BAI_API_KEY 并让 BAI_API_URL 指向 https://ovo1.cn/v1。未修改环境文件。'
}

$groqConfigured = Read-EnvValue $content 'GROQ_API_KEY'
$geminiConfigured = Read-EnvValue $content 'GEMINI_API_KEY'
if ($groqConfigured -or $geminiConfigured) {
  $masterKey = Read-EnvValue $content 'LITELLM_MASTER_KEY'
  if (-not $masterKey) {
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $masterKey = 'sk-' + ([Convert]::ToHexString($bytes).ToLowerInvariant())
  }
  $content = Set-EnvValueIfEmpty $content 'LITELLM_MASTER_KEY' $masterKey
  $content = Set-EnvValueIfEmpty $content 'LITELLM_API_KEY' $masterKey
  $content = Set-EnvValueIfEmpty $content 'LITELLM_API_URL' 'http://litellm:4000/v1'
  $content = Set-EnvValueIfEmpty $content 'LITELLM_API_TIER' 'unknown'
  $content = Set-EnvValueIfEmpty $content 'LITELLM_PRIVATE_DATA_AUTHORIZED' 'false'
  # Keep the primary text aliases on independent project/organization quota
  # pools when both providers exist. A Groq daily cap must not take the fast
  # alias and its smart fallback down together.
  if ($geminiConfigured) {
    $content = Set-EnvValueIfEmpty $content 'LITELLM_FAST_MODEL' 'gemini/gemini-3.5-flash-lite'
    $content = Set-EnvValueIfEmpty $content 'LITELLM_VISION_MODEL' 'gemini/gemini-3.7-flash'
    $content = Set-EnvValueIfEmpty $content 'LITELLM_OCR_MODEL' 'gemini/gemini-3.7-flash'
  } elseif ($groqConfigured) {
    $content = Set-EnvValueIfEmpty $content 'LITELLM_FAST_MODEL' 'groq/openai/gpt-oss-20b'
    $content = Set-EnvValueIfEmpty $content 'LITELLM_VISION_MODEL' 'groq/qwen/qwen3.8-27b'
    $content = Set-EnvValueIfEmpty $content 'LITELLM_OCR_MODEL' 'groq/qwen/qwen3.8-27b'
  }
  if ($groqConfigured) {
    $content = Set-EnvValueIfEmpty $content 'LITELLM_SMART_MODEL' 'groq/openai/gpt-oss-120b'
  } elseif ($geminiConfigured) {
    $content = Set-EnvValueIfEmpty $content 'LITELLM_SMART_MODEL' 'gemini/gemini-3.7-flash'
  }
}

$content = Set-EnvValue $content 'AI_PROVIDER_ORDER' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_COST_POLICY' 'free_first'
$content = Set-EnvValue $content 'AI_ALLOW_PAID_MODELS' 'true'
$content = Set-EnvValue $content 'AI_PAID_PROVIDER_ALLOWLIST' 'ovo'
$content = Set-EnvValue $content 'AI_PUBLIC_COST_POLICY' 'free_first'
$content = Set-EnvValue $content 'AI_PUBLIC_ALLOW_PAID_MODELS' 'true'
$content = Set-EnvValueIfEmpty $content 'AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS' 'false'
$content = Set-EnvValueIfEmpty $content 'AI_CATALOG_REFRESH_INTERVAL_MS' '21600000'
$content = Set-EnvValueIfEmpty $content 'AI_CATALOG_NEGATIVE_CACHE_MS' '60000'
$content = Set-EnvValueIfEmpty $content 'AI_CATALOG_TIMEOUT_MS' '5000'
$content = Set-EnvValueIfEmpty $content 'AI_PRICING_VERIFICATION_MAX_AGE_MS' '86400000'
$content = Set-EnvValueIfEmpty $content 'AI_PROVIDER_CIRCUIT_COOLDOWN_MS' '60000'
$content = Set-EnvValueIfEmpty $content 'AI_PROVIDER_5XX_COOLDOWN_MS' '900000'
$content = Set-EnvValueIfEmpty $content 'AI_COOLDOWN_PROBE_INTERVAL_MS' '60000'
$content = Set-EnvValueIfEmpty $content 'AI_TIMEOUT_MS' '30000'
$content = Set-EnvValueIfEmpty $content 'AI_MODEL_TIMEOUT_MS' '30000'
$content = Set-EnvValueIfEmpty $content 'AI_GATEWAY_DEADLINE_MS' '240000'
$content = Set-EnvValueIfEmpty $content 'AI_GATEWAY_CLIENT_TIMEOUT_MS' '270000'
$content = Set-EnvValueIfEmpty $content 'AI_PROXY_TIMEOUT_MS' '270000'
$content = Set-EnvValueIfEmpty $content 'AI_HTTP_RETRIES' '1'
$content = Set-EnvValueIfEmpty $content 'AI_CHAT_PLANNER_ENABLED' 'false'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_BULK_FILTER' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_TRANSLATION' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_CLASSIFICATION' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_IMAGE_ANALYSIS' 'ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_SELLER_ANALYSIS' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_COMPLEX_ANALYSIS' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_CROSS_VALIDATION' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_MARKET_ANALYSIS' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_CRAWLER_DIAGNOSIS' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_LOGISTICS_ANALYSIS' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_PROVIDER_ORDER_ASSISTANT_CHAT' 'gemini|ovo'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_BULK_FILTER' 'fast|smart'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_TRANSLATION' 'fast|smart'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_CLASSIFICATION' 'fast|smart'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_IMAGE_ANALYSIS' 'vision|ocr'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_SELLER_ANALYSIS' 'smart|fast'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_COMPLEX_ANALYSIS' 'smart|fast'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_CROSS_VALIDATION' 'smart|fast'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_MARKET_ANALYSIS' 'smart|fast'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_CRAWLER_DIAGNOSIS' 'smart|fast'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_LOGISTICS_ANALYSIS' 'vision|smart'
$content = Set-EnvValue $content 'AI_ROUTE_LITELLM_ASSISTANT_CHAT' 'smart|fast'
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
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_BULK_FILTER' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_TRANSLATION' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_CLASSIFICATION' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_IMAGE_ANALYSIS' 'gemini-3.7-flash'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_SELLER_ANALYSIS' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_COMPLEX_ANALYSIS' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_CROSS_VALIDATION' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_MARKET_ANALYSIS' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_CRAWLER_DIAGNOSIS' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_LOGISTICS_ANALYSIS' 'gemini-3.1-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_GEMINI_ASSISTANT_CHAT' 'gemini-3.1-flash-lite'
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
$content = Set-EnvValue $content 'AI_ROUTE_SILICONFLOW_TRANSLATION' 'Qwen/Qwen2.5-7B-Instruct|deepseek-ai/DeepSeek-V4-Flash'
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
$content = Set-EnvValue $content 'AI_ROUTE_CEREBRAS_IMAGE_ANALYSIS' 'gemma-4-31b'
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
$content = Set-EnvValue $content 'AI_ROUTE_CLOUDFLARE_IMAGE_ANALYSIS' '@cf/meta/llama-3.2-11b-vision-instruct|@cf/google/gemma-4-26b-a4b-it'
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
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_TRANSLATION' 'nvidia/riva-translate-4b-instruct-v2|nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_CLASSIFICATION' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_IMAGE_ANALYSIS' ''
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_SELLER_ANALYSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_COMPLEX_ANALYSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_CROSS_VALIDATION' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_MARKET_ANALYSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_CRAWLER_DIAGNOSIS' 'nvidia/nemotron-3-super-120b-a12b|nvidia/nemotron-3-nano-30b-a3b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_LOGISTICS_ANALYSIS' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_NVIDIA_ASSISTANT_CHAT' 'nvidia/nemotron-3-nano-30b-a3b|nvidia/nemotron-3-super-120b-a12b'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_BULK_FILTER' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_TRANSLATION' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_CLASSIFICATION' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_IMAGE_ANALYSIS' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_SELLER_ANALYSIS' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_COMPLEX_ANALYSIS' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_CROSS_VALIDATION' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_MARKET_ANALYSIS' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_CRAWLER_DIAGNOSIS' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_LOGISTICS_ANALYSIS' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_SENSENOVA_ASSISTANT_CHAT' 'sensenova-6.8-flash-lite'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_BULK_FILTER' 'minimax/minimax-m3:free|z-ai/glm-5.2:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_TRANSLATION' 'minimax/minimax-m3:free|z-ai/glm-5.2:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_CLASSIFICATION' 'minimax/minimax-m3:free|z-ai/glm-5.2:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_IMAGE_ANALYSIS' 'deepseek/deepseek-v4-flash-vision-exp|minimax/minimax-m3:free|z-ai/glm-5.2:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_SELLER_ANALYSIS' 'minimax/minimax-m3:free|z-ai/glm-5.2:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_COMPLEX_ANALYSIS' 'minimax/minimax-m3:free|nvidia/nemotron-3-ultra-550b-a55b:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_CROSS_VALIDATION' 'minimax/minimax-m3:free|nvidia/nemotron-3-ultra-550b-a55b:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_MARKET_ANALYSIS' 'minimax/minimax-m3:free|nvidia/nemotron-3-ultra-550b-a55b:free|z-ai/glm-5.2:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_CRAWLER_DIAGNOSIS' 'qwen/qwen3-coder|nvidia/nemotron-3-ultra-550b-a55b:free|z-ai/glm-5.2:free'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_LOGISTICS_ANALYSIS' 'minimax/minimax-m3:free|z-ai/glm-5.2:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OPENROUTER_ASSISTANT_CHAT' 'minimax/minimax-m3:free|z-ai/glm-5.2:free|deepseek/deepseek-v4-flash'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_BULK_FILTER' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_TRANSLATION' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_CLASSIFICATION' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_IMAGE_ANALYSIS' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_SELLER_ANALYSIS' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_COMPLEX_ANALYSIS' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_CROSS_VALIDATION' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_MARKET_ANALYSIS' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_CRAWLER_DIAGNOSIS' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_LOGISTICS_ANALYSIS' '*'
$content = Set-EnvValue $content 'AI_ROUTE_OVO_ASSISTANT_CHAT' '*'
$content = Set-EnvValue $content 'BACKGROUND_AI_MAX_CONCURRENCY' '1'
$content = Set-EnvValueIfEmpty $content 'BACKGROUND_AI_COOLDOWN_MS' '600000'
$content = Set-EnvValueIfEmpty $content 'BACKGROUND_AI_PAID_AUTOMATION_ENABLED' 'false'
$content = Set-EnvValueIfEmpty $content 'BACKGROUND_AI_FREE_AUTOMATION_ENABLED' 'true'

if ($content -notmatch '(?m)^AI_INTERNAL_TOKEN=\S+') {
  $bytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $content = Set-EnvValue $content 'AI_INTERNAL_TOKEN' $token
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($EnvPath, $content, $utf8NoBom)
$syncedDirectProviderCount = @(
  if (Read-EnvValue $content 'BAI_API_KEY') { 'configured' }
  if (Read-EnvValue $content 'GEMINI_API_KEY') { 'configured' }
  if (Read-EnvValue $content 'GROQ_API_KEY') { 'configured' }
  if (Read-EnvValue $content 'SILICONFLOW_API_KEY') { 'configured' }
  if (Read-EnvValue $content 'CEREBRAS_API_KEY') { 'configured' }
  if (
    (Read-EnvValue $content 'CLOUDFLARE_AI_API_TOKEN') -and
    (Read-EnvValue $content 'CLOUDFLARE_ACCOUNT_ID')
  ) { 'configured' }
  if (Read-EnvValue $content 'COHERE_API_KEY') { 'configured' }
  if (Read-EnvValue $content 'NVIDIA_API_KEY') { 'configured' }
  if (
    (Read-EnvValue $content 'SENSENOVA_API_KEY') -or
    (Read-EnvValue $content 'SENSENOVA_TRANSLATION_API_KEY') -or
    (Read-EnvValue $content 'SENSENOVA_SECONDARY_API_KEY')
  ) { 'configured' }
  if (Read-EnvValue $content 'OPENROUTER_API_KEY') { 'configured' }
).Count
Write-Host ("AI Provider 配置已安全同步；synced_direct_provider_count={0}；未输出任何密钥。" -f $syncedDirectProviderCount)
