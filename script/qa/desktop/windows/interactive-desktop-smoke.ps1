# Proves the Windows runner has an interactive desktop before the desktop QA driver runs: a child
# process shows a topmost WinForms form, this process brings it to the front, clicks its button
# through SendInput, and reads its label through UI Automation before and after.
# Prints `interactive-desktop: ok` on success; any failure throws (exit 1).
# Windows PowerShell 5.1 (.NET Framework ships UIAutomationClient in the GAC).
param([switch]$FormHost)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($FormHost) {
	# Child: host the form and report its handle, the button center, and clicks on stdout.
	Add-Type -AssemblyName System.Windows.Forms, System.Drawing
	$form = New-Object System.Windows.Forms.Form -Property @{
		Text = 'omo-interactive-desktop-smoke'; TopMost = $true; StartPosition = 'CenterScreen'; Width = 360; Height = 220
	}
	$button = New-Object System.Windows.Forms.Button -Property @{ Name = 'smokeButton'; Text = 'Click me'; Left = 20; Top = 20; Width = 140; Height = 50 }
	$label = New-Object System.Windows.Forms.Label -Property @{ Name = 'smokeLabel'; Text = 'waiting'; Left = 20; Top = 100; Width = 200 }
	$form.Controls.AddRange(@($button, $label))
	$button.Add_Click({
		$label.Text = 'clicked'
		[Console]::Out.WriteLine('clicked')
		[Console]::Out.Flush()
	})
	$form.Add_Shown({
		$form.Activate()
		$center = $button.PointToScreen((New-Object System.Drawing.Point -ArgumentList ([int]($button.Width / 2)), ([int]($button.Height / 2))))
		[Console]::Out.WriteLine("ready $($form.Handle.ToInt64()) $($center.X) $($center.Y) $($label.Handle.ToInt64())")
		[Console]::Out.Flush()
	})
	[System.Windows.Forms.Application]::Run($form)
	exit 0
}

$hangGuardMs = 30000
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SmokeInput {
	[StructLayout(LayoutKind.Sequential)]
	public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
	[StructLayout(LayoutKind.Sequential)]
	public struct INPUT { public uint type; public MOUSEINPUT mi; }
	[DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	public static uint LeftClick() {
		INPUT down = new INPUT { type = 0, mi = new MOUSEINPUT { dwFlags = 0x0002 } };
		INPUT up = new INPUT { type = 0, mi = new MOUSEINPUT { dwFlags = 0x0004 } };
		return SendInput(2, new INPUT[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
	}
}
'@

# Waits for the child's next stdout line, bounded by the hang guard.
function Read-ChildLine([System.Diagnostics.Process]$child, [string]$waitingFor) {
	$line = $child.StandardOutput.ReadLineAsync()
	if (-not $line.Wait($hangGuardMs)) { throw "interactive-desktop: timed out waiting for '$waitingFor'" }
	if ($null -eq $line.Result) { throw "interactive-desktop: form host exited before '$waitingFor' (exit $($child.ExitCode))" }
	return $line.Result
}

function Read-LabelText([IntPtr]$labelHwnd) {
	return [System.Windows.Automation.AutomationElement]::FromHandle($labelHwnd).Current.Name
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo -Property @{
	FileName = 'powershell.exe'
	Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -FormHost"
	UseShellExecute = $false
	RedirectStandardOutput = $true
}
$child = [System.Diagnostics.Process]::Start($startInfo)
try {
	$ready = (Read-ChildLine $child 'ready') -split ' '
	if ($ready[0] -ne 'ready') { throw "interactive-desktop: unexpected form host line '$($ready -join ' ')'" }
	$hwnd = [IntPtr][long]$ready[1]
	$x = [int]$ready[2]
	$y = [int]$ready[3]
	$labelHwnd = [IntPtr][long]$ready[4]

	$before = Read-LabelText $labelHwnd
	if ($before -ne 'waiting') { throw "interactive-desktop: label before click is '$before', expected 'waiting'" }

	$raised = [SmokeInput]::SetForegroundWindow($hwnd)
	$foreground = [SmokeInput]::GetForegroundWindow() -eq $hwnd
	Write-Host "interactive-desktop: setForegroundWindow=$raised foreground=$foreground"
	if (-not [SmokeInput]::SetCursorPos($x, $y)) { throw "interactive-desktop: SetCursorPos($x, $y) failed" }
	$sent = [SmokeInput]::LeftClick()
	if ($sent -ne 2) { throw "interactive-desktop: SendInput injected $sent of 2 events" }

	$clicked = Read-ChildLine $child 'clicked'
	if ($clicked -ne 'clicked') { throw "interactive-desktop: unexpected form host line '$clicked'" }
	$after = Read-LabelText $labelHwnd
	if ($after -ne 'clicked') { throw "interactive-desktop: label after click is '$after', expected 'clicked'" }
	Write-Host "interactive-desktop: uia label '$before' -> '$after'"
	Write-Host 'interactive-desktop: ok'
} finally {
	if (-not $child.HasExited) { $child.Kill() }
}
