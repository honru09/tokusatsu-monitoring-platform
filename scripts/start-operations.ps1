$ErrorActionPreference = 'Stop'
$opsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $opsRoot
try {
  & node 'apps/operations-gateway/init-accounts.mjs' (Join-Path $opsRoot '.private-operations')
  if ($LASTEXITCODE -ne 0) { throw '运营账号初始化失败' }
  & node 'apps/operations-gateway/init-browser-security.mjs' (Join-Path $opsRoot '.private-operations')
  if ($LASTEXITCODE -ne 0) { throw '运营浏览器保护初始化失败' }
  $opsSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls (Join-Path $opsRoot '.private-operations') /inheritance:r /grant:r "*${opsSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  foreach ($directory in @('xiaohongshu','douyin','materials/xiaohongshu','materials/douyin')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $opsRoot "data/operations/$directory") | Out-Null
  }
  & icacls (Join-Path $opsRoot 'data/operations') /inheritance:r /grant:r "*${opsSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
  & docker compose --env-file .env -f infrastructure/docker-compose.yml --profile operations up -d ops-egress ops-xiaohongshu ops-douyin ops-gateway web gateway
  if ($LASTEXITCODE -ne 0) { throw '运营服务启动失败' }
  Write-Output '运营台入口：http://localhost:3000/?workspace=operations'
  Write-Output '访问密码保存在 .private-operations/Operations-Accounts.txt；此脚本不会覆盖已有账号或浏览器资料。'
} finally { Pop-Location }
