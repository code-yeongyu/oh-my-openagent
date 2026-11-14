# Fails fast unless this process runs on an interactive desktop: a session other than 0 whose
# input desktop is "Default". Prints one line with what it read.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SmokeNative {
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformationW(IntPtr obj, int index, StringBuilder info, int length, out int needed);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
}
'@
$session = (Get-Process -Id $PID).SessionId
$desktop = [SmokeNative]::OpenInputDesktop(0, $false, 0x0001)
$name = ''
if ($desktop -ne [IntPtr]::Zero) {
  $buffer = New-Object System.Text.StringBuilder 256
  $needed = 0
  [void][SmokeNative]::GetUserObjectInformationW($desktop, 2, $buffer, 512, [ref]$needed)
  $name = $buffer.ToString()
  [void][SmokeNative]::CloseDesktop($desktop)
}
Write-Output "interactive-desktop-smoke session=$session inputDesktop=$name"
if ($session -eq 0 -or $name -ne 'Default') { throw "no interactive desktop (session $session, input desktop '$name')" }
