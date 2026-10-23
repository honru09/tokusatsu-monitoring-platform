Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\tokusatsu-monitoring-platform"
WshShell.Run """C:\Program Files\nodejs\node.exe"" ""D:\tokusatsu-monitoring-platform\scripts\entry-watchdog.mjs""", 0, False
Set WshShell = Nothing
