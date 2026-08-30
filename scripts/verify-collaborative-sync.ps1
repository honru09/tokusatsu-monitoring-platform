$ErrorActionPreference = "Stop"
$apiBase = if ($env:SYNC_API_BASE) { $env:SYNC_API_BASE } else { "http://localhost:3001" }
$item = (Invoke-RestMethod "$apiBase/items?limit=1").items[0]
if (-not $item) { throw "No active item available for sync test" }
$oldValue = [bool]$item.favorite
$nextValue = -not $oldValue
$since = [DateTime]::UtcNow.AddSeconds(-1).ToString("o")
$timer = [Diagnostics.Stopwatch]::StartNew()
$response = Invoke-RestMethod -Method Patch -Uri "$apiBase/items/$($item.id)" -ContentType "application/json" -Body (@{ favorite = $nextValue; actor = "sync-regression" } | ConvertTo-Json)
$timer.Stop()
try {
  if ($response.item.id -ne $item.id -or $response.item.favorite -ne $nextValue) { throw "PATCH did not return the updated favorite" }
  $changes = Invoke-RestMethod "$apiBase/items/changes?since=$([uri]::EscapeDataString($since))"
  if (-not ($changes.changes | Where-Object { $_.id -eq $item.id -and $_.favorite -eq $nextValue })) { throw "Incremental changes endpoint did not expose the update" }
  if ($timer.ElapsedMilliseconds -gt 1000) { throw "Collaborative PATCH took $($timer.ElapsedMilliseconds) ms" }
  Write-Output "PASS collaborative favorite sync: $($timer.ElapsedMilliseconds) ms"
}
finally {
  Invoke-RestMethod -Method Patch -Uri "$apiBase/items/$($item.id)" -ContentType "application/json" -Body (@{ favorite = $oldValue; actor = "sync-regression-cleanup" } | ConvertTo-Json) | Out-Null
}
