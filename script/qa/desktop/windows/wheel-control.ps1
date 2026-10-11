# The control of the foreground scroll-direction scenario (script/qa/desktop/windows.ts): injects one
# vertical wheel event of `Delta` through SendInput at screen point (X, Y), exactly as a real mouse
# would, independent of the engine. Parks the cursor there with SetCursorPos first, like the
# interactive-desktop smoke. Prints `sent <n>` (1 when Win32 accepted the event).
param([Parameter(Mandatory = $true)][int]$X, [Parameter(Mandatory = $true)][int]$Y, [Parameter(Mandatory = $true)][int]$Delta)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QaWheelControl {
	[StructLayout(LayoutKind.Sequential)]
	public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
	[StructLayout(LayoutKind.Sequential)]
	public struct INPUT { public uint type; public MOUSEINPUT mi; }
	[DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
	[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	public static uint Wheel(int delta) {
		INPUT wheel = new INPUT { type = 0, mi = new MOUSEINPUT { mouseData = unchecked((uint)delta), dwFlags = 0x0800 } };
		return SendInput(1, new INPUT[] { wheel }, Marshal.SizeOf(typeof(INPUT)));
	}
}
'@
# Physical pixels, like the observer's rects.
[void][QaWheelControl]::SetProcessDpiAwarenessContext([IntPtr]-4)
if (-not [QaWheelControl]::SetCursorPos($X, $Y)) { throw "SetCursorPos($X, $Y) failed" }
Write-Output "sent $([QaWheelControl]::Wheel($Delta))"
