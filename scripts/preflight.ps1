$ErrorActionPreference = 'Stop'

function Test-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Error "缺少命令：$Name"
  }
}

Test-Command docker
Test-Command wsl

Write-Host '检查 Docker Desktop 守护进程...'
$dockerOutput = docker version --format 'Docker Server {{.Server.Version}}' 2>&1
$dockerExitCode = $LASTEXITCODE
$dockerOutput | Out-Host
if ($dockerExitCode -ne 0) {
  Write-Error 'Docker 守护进程不可用。若日志显示 wsl --version 失败，请先在管理员终端运行 wsl --update，按系统提示重启后再试。'
}

$ports = 3000, 3001, 6379, 55432
$occupied = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports }
if ($occupied) {
  Write-Warning ('以下部署端口已被占用：' + (($occupied.LocalPort | Sort-Object -Unique) -join ', '))
}

Write-Host '预检通过。'
