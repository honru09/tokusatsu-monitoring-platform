$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$syncScript = Join-Path $PSScriptRoot 'sync-ai-secrets.ps1'
$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = [IO.Path]::GetFullPath(
  (Join-Path $systemTemp ("tokusatsu-sync-ai-secrets-{0}" -f [guid]::NewGuid()))
)
if (-not $testRoot.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Temporary test directory escaped the system temporary directory.'
}
$utf8NoBom = [Text.UTF8Encoding]::new($false)

function Write-Fixture([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Read-FixtureEnvironment([string]$Path) {
  $result = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -notmatch '^(?<name>[A-Z][A-Z0-9_]*)=(?<value>.*)$') { continue }
    $result[$Matches['name']] = $Matches['value']
  }
  return $result
}

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Message) {
  if ($Actual -ne $Expected) { throw $Message }
}

try {
  [IO.Directory]::CreateDirectory($testRoot) | Out-Null

  $main = 'sk-' + ('m' * 16)
  $translation = 'sk-' + ('t' * 16)
  $secondary = 'sk-' + ('s' * 16)
  $existingSecondary = 'sk-' + ('p' * 16)

  $twoBlockCredentials = @"
https://platform.sensenova.cn/console
Main
$main
Translate
$translation
https://platform.sensenova.cn/console
Main
$secondary
"@
  $emptyTarget = @"
SENSENOVA_API_KEY=
SENSENOVA_TRANSLATION_API_KEY=
SENSENOVA_SECONDARY_API_KEY=
AI_INTERNAL_TOKEN=fixture-only
UNRELATED_SENTINEL=preserve-me
"@
  $credentialsPath = Join-Path $testRoot 'credentials-two-block.fixture'
  $targetPath = Join-Path $testRoot 'target-two-block.fixture'
  Write-Fixture $credentialsPath $twoBlockCredentials
  Write-Fixture $targetPath $emptyTarget
  & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath *> $null
  $twoBlockResult = Read-FixtureEnvironment $targetPath
  Assert-Equal $twoBlockResult['SENSENOVA_API_KEY'] $main 'Primary SenseNova fixture was not synchronized.'
  Assert-Equal $twoBlockResult['SENSENOVA_TRANSLATION_API_KEY'] $translation 'Translation SenseNova fixture was not synchronized.'
  Assert-Equal $twoBlockResult['SENSENOVA_SECONDARY_API_KEY'] $secondary 'Second SenseNova account fixture was not synchronized.'
  Assert-Equal $twoBlockResult['UNRELATED_SENTINEL'] 'preserve-me' 'An unrelated existing value was changed.'

  $explicitSecondaryCredentials = @"
https://platform.sensenova.cn/console
Main
$main
Secondary
$secondary
"@
  $preconfiguredTarget = @"
SENSENOVA_API_KEY=
SENSENOVA_SECONDARY_API_KEY=$existingSecondary
AI_INTERNAL_TOKEN=fixture-only
"@
  $credentialsPath = Join-Path $testRoot 'credentials-explicit-secondary.fixture'
  $targetPath = Join-Path $testRoot 'target-preconfigured.fixture'
  Write-Fixture $credentialsPath $explicitSecondaryCredentials
  Write-Fixture $targetPath $preconfiguredTarget
  & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath *> $null
  $preservedResult = Read-FixtureEnvironment $targetPath
  Assert-Equal $preservedResult['SENSENOVA_SECONDARY_API_KEY'] $existingSecondary 'An existing secondary SenseNova value was overwritten.'

  $unknownLabelCredentials = @"
https://platform.sensenova.cn/console
Main
$main
Backup
$secondary
"@
  $credentialsPath = Join-Path $testRoot 'credentials-unknown-label.fixture'
  $targetPath = Join-Path $testRoot 'target-unknown-label.fixture'
  Write-Fixture $credentialsPath $unknownLabelCredentials
  Write-Fixture $targetPath $emptyTarget
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath *> $null
  } catch {
    $rejected = $_.Exception.Message -like '*SenseNova*未知标签*'
  }
  if (-not $rejected) { throw 'An unknown SenseNova label followed by a key-like value was accepted.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'Unknown SenseNova label rejection changed the target file.'

  $unlabeledExtraKeyCredentials = @"
https://platform.sensenova.cn/console
Main
$main
$secondary
"@
  $credentialsPath = Join-Path $testRoot 'credentials-unlabeled-extra-key.fixture'
  $targetPath = Join-Path $testRoot 'target-unlabeled-extra-key.fixture'
  Write-Fixture $credentialsPath $unlabeledExtraKeyCredentials
  Write-Fixture $targetPath $emptyTarget
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath *> $null
  } catch {
    $rejected = $_.Exception.Message -like '*SenseNova*未标记*'
  }
  if (-not $rejected) { throw 'An unlabeled extra SenseNova key was accepted.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'Unlabeled SenseNova key rejection changed the target file.'

  $ambiguousCredentials = @"
https://platform.sensenova.cn/console
Main
$main
https://platform.sensenova.cn/console
Main
$secondary
https://platform.sensenova.cn/console
Main
$translation
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ambiguous.fixture'
  $targetPath = Join-Path $testRoot 'target-ambiguous.fixture'
  Write-Fixture $credentialsPath $ambiguousCredentials
  Write-Fixture $targetPath $emptyTarget
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath *> $null
  } catch {
    $rejected = $true
  }
  if (-not $rejected) { throw 'Ambiguous SenseNova account blocks were accepted.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'A rejected sync changed the target file.'

  $legacyOvoTarget = @"
BAI_API_KEY=legacy-ovo-fixture
BAI_API_URL=https://ovo1.cn/v1
OVO_API_KEY=
AI_INTERNAL_TOKEN=fixture-only
"@
  $credentialsPath = Join-Path $testRoot 'credentials-empty.fixture'
  $targetPath = Join-Path $testRoot 'target-legacy-ovo.fixture'
  Write-Fixture $credentialsPath ''
  Write-Fixture $targetPath $legacyOvoTarget
  & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  $legacyOvoResult = Read-FixtureEnvironment $targetPath
  Assert-Equal $legacyOvoResult['AI_PROVIDER_ORDER'] 'ovo' 'Production provider order was not restricted to OVO.'
  Assert-Equal $legacyOvoResult['AI_ALLOW_PAID_MODELS'] 'true' 'Paid OVO route was not authorized.'
  Assert-Equal $legacyOvoResult['AI_PAID_PROVIDER_ALLOWLIST'] 'ovo' 'Paid provider allowlist was not restricted to OVO.'
  Assert-Equal $legacyOvoResult['AI_ROUTE_OVO_TRANSLATION'] 'gpt-5.6-luna' 'OVO Luna fail-closed route drifted.'
  Assert-Equal $legacyOvoResult['BACKGROUND_AI_PAID_AUTOMATION_ENABLED'] 'false' 'Paid background work was enabled before a live canary.'

  $ovoConsoleKey = 'sk-' + ('o' * 32)
  $ovoConsoleCredentials = @"
https://ovo1.cn/
$ovoConsoleKey
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ovo-console.fixture'
  $targetPath = Join-Path $testRoot 'target-ovo-console.fixture'
  Write-Fixture $credentialsPath $ovoConsoleCredentials
  Write-Fixture $targetPath "AI_INTERNAL_TOKEN=fixture-only`n"
  & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  $ovoConsoleResult = Read-FixtureEnvironment $targetPath
  Assert-Equal $ovoConsoleResult['OVO_API_KEY'] $ovoConsoleKey 'OVO key adjacent to the official console URL was not synchronized.'
  Assert-Equal $ovoConsoleResult['OVO_API_URL'] 'https://ovo1.cn/v1' 'OVO API endpoint was not pinned to the approved HTTPS host.'
  Assert-Equal $ovoConsoleResult['AI_PROVIDER_ORDER'] 'ovo' 'Console-adjacent OVO credential did not activate the OVO-only route.'

  $ovoWithPausedProviderCredentials = @"
https://platform.sensenova.cn/console/keys
Account2:
sk-$('s' * 32)
https://ovo1.cn/
$ovoConsoleKey
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ovo-with-paused-provider.fixture'
  $targetPath = Join-Path $testRoot 'target-ovo-with-paused-provider.fixture'
  Write-Fixture $credentialsPath $ovoWithPausedProviderCredentials
  Write-Fixture $targetPath "SENSENOVA_API_KEY=preserve-paused-value`nAI_INTERNAL_TOKEN=fixture-only`n"
  & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  $ovoWithPausedProviderResult = Read-FixtureEnvironment $targetPath
  Assert-Equal $ovoWithPausedProviderResult['OVO_API_KEY'] $ovoConsoleKey 'A paused provider format prevented OVO synchronization.'
  Assert-Equal $ovoWithPausedProviderResult['SENSENOVA_API_KEY'] 'preserve-paused-value' 'OVO-only deployment changed a paused provider credential.'

  $sameOvoCredentials = @"
OVO API Key: $ovoConsoleKey
https://ovo1.cn/
$ovoConsoleKey
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ovo-same.fixture'
  $targetPath = Join-Path $testRoot 'target-ovo-same.fixture'
  Write-Fixture $credentialsPath $sameOvoCredentials
  Write-Fixture $targetPath "AI_INTERNAL_TOKEN=fixture-only`n"
  & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  $sameOvoResult = Read-FixtureEnvironment $targetPath
  Assert-Equal $sameOvoResult['OVO_API_KEY'] $ovoConsoleKey 'Matching labeled and console-adjacent OVO keys were not accepted.'

  $conflictingOvoKey = 'sk-' + ('x' * 32)
  $conflictingOvoCredentials = @"
OVO API Key: $conflictingOvoKey
https://ovo1.cn/
$ovoConsoleKey
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ovo-conflict.fixture'
  $targetPath = Join-Path $testRoot 'target-ovo-conflict.fixture'
  Write-Fixture $credentialsPath $conflictingOvoCredentials
  Write-Fixture $targetPath "AI_INTERNAL_TOKEN=fixture-only`nUNRELATED_SENTINEL=preserve-me`n"
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  } catch {
    $rejected = $_.Exception.Message -like '*OVO*不一致*'
  }
  if (-not $rejected) { throw 'Conflicting labeled and console-adjacent OVO keys were accepted.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'Rejected conflicting OVO credentials changed the target file.'

  $ambiguousOvoCredentials = @"
https://ovo1.cn/
$ovoConsoleKey
https://ovo1.cn
$conflictingOvoKey
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ovo-ambiguous.fixture'
  $targetPath = Join-Path $testRoot 'target-ovo-ambiguous.fixture'
  Write-Fixture $credentialsPath $ambiguousOvoCredentials
  Write-Fixture $targetPath "AI_INTERNAL_TOKEN=fixture-only`n"
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  } catch {
    $rejected = $_.Exception.Message -like '*多个不同的 OVO key*'
  }
  if (-not $rejected) { throw 'Multiple different console-adjacent OVO keys were accepted.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'Rejected ambiguous OVO credentials changed the target file.'

  $unsafeOvoCredentials = @"
https://ovo1.cn/
https://example.com/not-a-key
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ovo-unsafe.fixture'
  $targetPath = Join-Path $testRoot 'target-ovo-unsafe.fixture'
  Write-Fixture $credentialsPath $unsafeOvoCredentials
  Write-Fixture $targetPath "AI_INTERNAL_TOKEN=fixture-only`n"
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  } catch {
    $rejected = $_.Exception.Message -like '*OVO*不是安全的单值 key*'
  }
  if (-not $rejected) { throw 'An unsafe value after the OVO console URL was accepted.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'Rejected unsafe OVO credentials changed the target file.'

  $untrustedOvoCredentials = @"
https://evil.ovo1.cn/
$ovoConsoleKey
"@
  $credentialsPath = Join-Path $testRoot 'credentials-ovo-untrusted-host.fixture'
  $targetPath = Join-Path $testRoot 'target-ovo-untrusted-host.fixture'
  Write-Fixture $credentialsPath $untrustedOvoCredentials
  Write-Fixture $targetPath "AI_INTERNAL_TOKEN=fixture-only`n"
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  } catch {
    $rejected = $_.Exception.Message -like '*OVO*'
  }
  if (-not $rejected) { throw 'RequireOvo accepted a key adjacent to an untrusted OVO subdomain.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'Rejected untrusted OVO host changed the target file.'

  $targetPath = Join-Path $testRoot 'target-missing-ovo.fixture'
  Write-Fixture $targetPath "AI_INTERNAL_TOKEN=fixture-only`n"
  $beforeRejectedSync = [IO.File]::ReadAllText($targetPath)
  $rejected = $false
  try {
    & $syncScript -KeysPath $credentialsPath -EnvPath $targetPath -RequireOvo *> $null
  } catch {
    $rejected = $_.Exception.Message -like '*OVO*'
  }
  if (-not $rejected) { throw 'RequireOvo accepted a target without an OVO credential.' }
  Assert-Equal ([IO.File]::ReadAllText($targetPath)) $beforeRejectedSync 'Rejected OVO sync changed the target file.'

  Write-Host 'sync-ai-secrets targeted tests passed.'
} finally {
  if (
    (Test-Path -LiteralPath $testRoot) -and
    $testRoot.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)
  ) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
