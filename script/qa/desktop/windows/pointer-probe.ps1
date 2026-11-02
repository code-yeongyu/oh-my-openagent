# Independent probe for the foreground pointer scenarios (script/qa/desktop/windows.ts): reads the
# cursor, the foreground window, the window under the cursor and, per window, its screen rect and its
# EDIT's first visible line and selection through Win32 - never through the engine - and prints one JSON
# object. `-ParkX/-ParkY` first parks the cursor with SetCursorPos (the stale position a scenario
# starts from). Windows PowerShell 5.1.
param([string]$Windows = '', [int]$ParkX = [int]::MinValue, [int]$ParkY = [int]::MinValue)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QaPointerProbe {
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
	[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
	[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
	[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
	[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
	[DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
	// EM_GETFIRSTVISIBLELINE; -1 when the window does not answer (SMTO_ABORTIFHUNG, 2 s).
	public static long FirstVisibleLine(IntPtr edit) {
		IntPtr line;
		if (SendMessageTimeoutW(edit, 0x00CE, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out line) == IntPtr.Zero) return -1;
		return line.ToInt64();
	}
	// EM_GETSEL with null pointers answers start in the low word and end in the high word (the host's
	// document is far below 65536 characters); {-1, -1} when the window does not answer.
	public static int[] Selection(IntPtr edit) {
		IntPtr packed;
		if (SendMessageTimeoutW(edit, 0x00B0, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out packed) == IntPtr.Zero) return new int[] { -1, -1 };
		long bits = packed.ToInt64();
		return new int[] { (int)(bits & 0xFFFF), (int)((bits >> 16) & 0xFFFF) };
	}
}
'@
# Physical pixels, like the engine and the pointer hosts.
[void][QaPointerProbe]::SetProcessDpiAwarenessContext([IntPtr]-4)

$parked = $null
if ($ParkX -ne [int]::MinValue) { $parked = [QaPointerProbe]::SetCursorPos($ParkX, $ParkY) }

# PowerShell names are case-insensitive: this must not be called $windows, which is the -Windows parameter.
$states = [ordered]@{}
# `-Windows form:edit,form:edit` - each form hwnd with its EDIT child's hwnd.
foreach ($pair in ($Windows -split ',' | Where-Object { $_ -ne '' })) {
	$form, $edit = $pair -split ':'
	$formHwnd = [IntPtr][long]$form
	$editHwnd = [IntPtr][long]$edit
	if (-not [QaPointerProbe]::IsWindow($formHwnd)) { $states[$form] = [ordered]@{ exists = $false }; continue }
	$rect = New-Object QaPointerProbe+RECT
	[void][QaPointerProbe]::GetWindowRect($formHwnd, [ref]$rect)
	$selection = [QaPointerProbe]::Selection($editHwnd)
	$states[$form] = [ordered]@{
		exists = $true
		rect = [ordered]@{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }
		firstVisibleLine = [QaPointerProbe]::FirstVisibleLine($editHwnd)
		selection = [ordered]@{ start = $selection[0]; end = $selection[1] }
	}
}

$cursor = New-Object QaPointerProbe+POINT
$cursorOk = [QaPointerProbe]::GetCursorPos([ref]$cursor)
$under = [QaPointerProbe]::WindowFromPoint($cursor)
$underRoot = if ($under -eq [IntPtr]::Zero) { [IntPtr]::Zero } else { [QaPointerProbe]::GetAncestor($under, 2) }
[ordered]@{
	parked = $parked
	virtualScreen = [ordered]@{
		x = [QaPointerProbe]::GetSystemMetrics(76); y = [QaPointerProbe]::GetSystemMetrics(77)
		width = [QaPointerProbe]::GetSystemMetrics(78); height = [QaPointerProbe]::GetSystemMetrics(79)
	}
	cursorOk = $cursorOk
	cursor = [ordered]@{ x = $cursor.X; y = $cursor.Y }
	cursorRoot = $underRoot.ToInt64()
	foreground = [QaPointerProbe]::GetForegroundWindow().ToInt64()
	windows = $states
} | ConvertTo-Json -Depth 5 -Compress
