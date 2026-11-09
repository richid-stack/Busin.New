' Starts the OpenLobs Bridge with no window and writes what it does to a log file.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = shell.ExpandEnvironmentStrings("%APPDATA%") & "\OpenLobsBridge"
q = Chr(34)
shell.Run q & dir & "\openlobs-bridge.exe" & q & " " & q & dir & "\bridge.mjs" & q & " run --log " & q & logDir & "\bridge.log" & q, 0, False
