$ErrorActionPreference = 'Stop'
$entryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entryIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$entrySid = $entryIdentity.User.Value
& icacls (Join-Path $entryRoot '.private-entry') /inheritance:r /grant:r "*${entrySid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot secure entry state directory' }
$entryScript = Join-Path $entryRoot 'scripts/start-entry-watchdog.ps1'
$entryAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $entryScript + '" -Foreground') -WorkingDirectory $entryRoot
$entryTrigger = New-ScheduledTaskTrigger -AtLogOn -User $entryIdentity.Name
$entrySettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$entryPrincipal = New-ScheduledTaskPrincipal -UserId $entryIdentity.Name -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'KamenProcurementEntryWatchdog' -Action $entryAction -Trigger $entryTrigger -Settings $entrySettings -Principal $entryPrincipal -Description 'Maintain the existing local procurement tunnel; reuse healthy URL, recover failures.' -Force | Out-Null
Start-ScheduledTask -TaskName 'KamenProcurementEntryWatchdog'
Write-Output '已安装当前用户登录后自动启动的公网链接守护。'
