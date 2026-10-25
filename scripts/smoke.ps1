$ErrorActionPreference = 'Stop'

function Wait-Endpoint([string]$Name, [string]$Url, [int]$Attempts = 30) {
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $result = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($result.StatusCode -eq 200) {
        Write-Host "[OK] $Name $Url"
        return
      }
    } catch {
      if ($i -eq $Attempts) { throw "$Name 在等待后仍不可用：$Url" }
    }
    Start-Sleep -Seconds 2
  }
}

Wait-Endpoint 'API health' 'http://localhost:3001/health'
Wait-Endpoint 'API items' 'http://localhost:3001/items?limit=1'
Wait-Endpoint 'Web' 'http://localhost:3000'

$items = Invoke-RestMethod -Uri 'http://localhost:3001/items?limit=5' -TimeoutSec 5
if ($items.total -lt 1) { throw '采集 Worker 尚未写入 Mock 商品。请检查 worker 日志。' }
Write-Host "[OK] 端到端验收通过，当前商品数：$($items.total)"
