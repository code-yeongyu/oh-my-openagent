# Independent observer for the Windows desktop QA driver (script/qa/desktop/windows.ts): reads the
# OS state the engine claims to change through Win32, UI Automation, and whoami - never through the
# engine - and prints it as one JSON object. Windows PowerShell 5.1 (.NET Framework ships
# UIAutomationClient in the GAC).
param([string]$Hwnds = '', [int]$IntegrityPid = 0)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class QaObserver {
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
	[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder name, int max);
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
	[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
	[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
	[DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
	[DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
	[DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
	[DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buffer, int length, out int needed);
	[DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
	[DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
	delegate bool ChildProc(IntPtr hwnd, IntPtr lParam);
	[DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, ChildProc proc, IntPtr lParam);
	[DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")] static extern IntPtr SendLength(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
	[DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)] static extern IntPtr SendText(IntPtr hwnd, uint msg, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);
	// First descendant window of class Edit, RichEdit*, or a WinForms EDIT (`WindowsForms10.EDIT.*`);
	// IntPtr.Zero when there is none.
	public static IntPtr EditChild(IntPtr parent) {
		IntPtr found = IntPtr.Zero;
		EnumChildWindows(parent, (hwnd, unused) => {
			string name = ClassName(hwnd);
			if (name == "Edit" || name.StartsWith("RichEdit") || name.Contains(".EDIT.")) { found = hwnd; return false; }
			return true;
		}, IntPtr.Zero);
		return found;
	}
	// The window's text through WM_GETTEXTLENGTH/WM_GETTEXT, which Win32 marshals across processes;
	// null when the window does not answer within the timeout (SMTO_ABORTIFHUNG).
	public static string WindowText(IntPtr hwnd) {
		IntPtr length;
		if (SendLength(hwnd, 0x000E, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out length) == IntPtr.Zero) return null;
		var text = new StringBuilder(length.ToInt32() + 1);
		IntPtr copied;
		if (SendText(hwnd, 0x000D, (IntPtr)text.Capacity, text, 0x0002, 2000, out copied) == IntPtr.Zero) return null;
		return text.ToString();
	}
	// EM_GETFIRSTVISIBLELINE of the window's edit child: the zero-based line at the top of its view;
	// -1 when there is no edit child or it does not answer.
	public static long FirstVisibleLine(IntPtr parent) {
		IntPtr edit = EditChild(parent);
		if (edit == IntPtr.Zero) return -1;
		IntPtr line;
		if (SendLength(edit, 0x00CE, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out line) == IntPtr.Zero) return -1;
		return line.ToInt64();
	}
	public static string ClassName(IntPtr hwnd) { var name = new StringBuilder(256); GetClassNameW(hwnd, name, name.Capacity); return name.ToString(); }
	public static uint ProcessId(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid; }
	// Mandatory-label RID of process `pid` (0x1000 low, 0x2000 medium, 0x3000 high, 0x4000 system); -1 when unreadable.
	public static long IntegrityRid(uint pid) {
		IntPtr process = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
		if (process == IntPtr.Zero) return -1;
		IntPtr token;
		try { if (!OpenProcessToken(process, 0x0008, out token)) return -1; } finally { CloseHandle(process); } // TOKEN_QUERY
		try {
			int needed;
			GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed); // TokenIntegrityLevel size query
			IntPtr buffer = Marshal.AllocHGlobal(needed);
			try {
				if (!GetTokenInformation(token, 25, buffer, needed, out needed)) return -1;
				IntPtr sid = Marshal.ReadIntPtr(buffer);
				int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
				return (uint)Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
			} finally { Marshal.FreeHGlobal(buffer); }
		} finally { CloseHandle(token); }
	}
}
'@
# Per-monitor-v2 awareness (-4) before any window API, so the cursor and screen bounds are physical
# pixels like the engine's.
$dpiAware = [QaObserver]::SetProcessDpiAwarenessContext([IntPtr]-4)
Add-Type -AssemblyName System.Windows.Forms, UIAutomationClient, UIAutomationTypes
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Test-Editable($element) {
	$id = $element.Current.ControlType.Id
	return $id -eq [System.Windows.Automation.ControlType]::Edit.Id -or $id -eq [System.Windows.Automation.ControlType]::Document.Id
}

# The first Edit or Document under `root`: a UIA FindFirst, then a breadth-first raw-view walk (bounded),
# since the condition search can miss proxied Win32 controls.
function Find-Editable($root) {
	$type = [System.Windows.Automation.AutomationElement]::ControlTypeProperty
	$editable = New-Object System.Windows.Automation.OrCondition -ArgumentList @(
		(New-Object System.Windows.Automation.PropertyCondition -ArgumentList $type, ([System.Windows.Automation.ControlType]::Edit)),
		(New-Object System.Windows.Automation.PropertyCondition -ArgumentList $type, ([System.Windows.Automation.ControlType]::Document)))
	$element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editable)
	if ($null -ne $element) { return @{ element = $element; via = 'uia-find' } }
	$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
	$queue = New-Object System.Collections.Queue
	$queue.Enqueue($root)
	$visited = 0
	while ($queue.Count -gt 0 -and $visited -lt 500) {
		$child = $walker.GetFirstChild($queue.Dequeue())
		while ($null -ne $child) {
			$visited++
			if (Test-Editable $child) { return @{ element = $child; via = 'uia-walk' } }
			$queue.Enqueue($child)
			$child = $walker.GetNextSibling($child)
		}
	}
	return $null
}

# The editable text of window `hwnd`: through UI Automation, else through Win32 WM_GETTEXT on its Edit or
# RichEdit child. `readVia` records which read produced it.
function Read-EditableText([IntPtr]$hwnd) {
	$found = Find-Editable ([System.Windows.Automation.AutomationElement]::FromHandle($hwnd))
	if ($null -eq $found) {
		$edit = [QaObserver]::EditChild($hwnd)
		if ($edit -eq [IntPtr]::Zero) { return [ordered]@{ controlType = $null; text = $null; readVia = $null } }
		return [ordered]@{ controlType = 'Win32.' + [QaObserver]::ClassName($edit); text = [QaObserver]::WindowText($edit); readVia = 'win32' }
	}
	$element = $found.element
	$pattern = $null
	if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
		$text = $pattern.Current.Value
	} elseif ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
		$text = $pattern.DocumentRange.GetText(-1)
	} else {
		$text = $element.Current.Name
	}
	return [ordered]@{ controlType = $element.Current.ControlType.ProgrammaticName; text = $text; readVia = $found.via }
}

# `whoami /groups` names the runner token's mandatory label, e.g. `Mandatory Label\High Mandatory Level`.
$label = (whoami /groups | Select-String -Pattern 'Mandatory Label\\(\w+) Mandatory Level' | Select-Object -First 1)
$runnerIntegrity = if ($null -eq $label) { $null } else { $label.Matches[0].Groups[1].Value.ToLowerInvariant() }

$windows = [ordered]@{}
foreach ($id in ($Hwnds -split ',' | Where-Object { $_ -ne '' })) {
	$hwnd = [IntPtr][long]$id
	if (-not [QaObserver]::IsWindow($hwnd)) {
		$windows[$id] = [ordered]@{ exists = $false }
		continue
	}
	$ownerPid = [QaObserver]::ProcessId($hwnd)
	$process = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
	$entry = [ordered]@{
		exists = $true
		class = [QaObserver]::ClassName($hwnd)
		pid = $ownerPid
		processName = if ($null -eq $process) { $null } else { $process.ProcessName }
		firstVisibleLine = [QaObserver]::FirstVisibleLine($hwnd)
	}
	$rect = New-Object QaObserver+RECT
	if ([QaObserver]::GetWindowRect($hwnd, [ref]$rect)) {
		$entry.rect = [ordered]@{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }
	}
	try {
		$read = Read-EditableText $hwnd
		$entry.controlType = $read.controlType
		$entry.text = $read.text
		$entry.readVia = $read.readVia
	} catch {
		# A window UIA cannot read (e.g. a system window) is reported, not fatal.
		$entry.readError = $_.Exception.Message
	}
	$windows[$id] = $entry
}

$foreground = [QaObserver]::GetForegroundWindow()
$cursor = [System.Windows.Forms.Cursor]::Position
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
# The window the cursor is over (what hover wheel routing delivers to) and its top-level root.
$cursorPoint = New-Object QaObserver+POINT -Property @{ X = $cursor.X; Y = $cursor.Y }
$under = [QaObserver]::WindowFromPoint($cursorPoint)
$underRoot = if ($under -eq [IntPtr]::Zero) { [IntPtr]::Zero } else { [QaObserver]::GetAncestor($under, 2) }
$result = [ordered]@{
	dpiAware = $dpiAware
	foreground = $foreground.ToInt64()
	foregroundClass = if ($foreground -eq [IntPtr]::Zero) { '' } else { [QaObserver]::ClassName($foreground) }
	cursor = [ordered]@{ x = $cursor.X; y = $cursor.Y }
	cursorWindow = [ordered]@{
		hwnd = $under.ToInt64()
		class = if ($under -eq [IntPtr]::Zero) { '' } else { [QaObserver]::ClassName($under) }
		root = $underRoot.ToInt64()
	}
	primaryScreen = [ordered]@{ x = $screen.X; y = $screen.Y; width = $screen.Width; height = $screen.Height }
	runnerIntegrity = $runnerIntegrity
	windows = $windows
}
if ($IntegrityPid -gt 0) { $result.integrityRid = [QaObserver]::IntegrityRid([uint32]$IntegrityPid) }
$result | ConvertTo-Json -Depth 6 -Compress
