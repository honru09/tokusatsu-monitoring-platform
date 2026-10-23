param([switch]$Foreground)
$ErrorActionPreference = 'Stop'
$entryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Foreground) {
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'),'-Foreground') -WorkingDirectory $entryRoot
  Write-Output '公网链接守护已启动；重复启动会复用现有守护。'
  exit
}
$entrySid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$entryLock = [Threading.Mutex]::new($false, "Global\KamenProcurementEntryWatchdog-$entrySid")
$entryOwned = $false
try {
  try { $entryOwned = $entryLock.WaitOne(0) } catch [Threading.AbandonedMutexException] { $entryOwned = $true }
  if (-not $entryOwned) { exit }
  do { & node (Join-Path $entryRoot 'scripts/entry-watchdog.mjs'); Start-Sleep -Seconds 30 } while ($true)
} finally { if ($entryOwned) { $entryLock.ReleaseMutex() }; $entryLock.Dispose() }
