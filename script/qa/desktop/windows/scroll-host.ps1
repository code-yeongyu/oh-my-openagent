# Hosts a WinForms window whose multi-line TextBox (a Win32 EDIT underneath) holds a long document,
# scrolled to its middle so a wheel step either way moves it, for the scroll-direction scenarios of
# script/qa/desktop/windows.ts. Prints `ready <hwnd>` once the window is shown and runs until the
# driver kills it; every wheel, focus and activation event the window sees is appended to $EventLog,
# so a scenario can tell a wheel that never arrived from one that arrived and did not scroll. Before
# `ready`, the log also gets `lineHeight <px>`: the EDIT's own distance between two consecutive lines,
# so a scenario converts lines scrolled into pixels without assuming a font.
# Run with `powershell.exe -STA`.
param(
	[Parameter(Mandatory = $true)][string]$Title,
	[Parameter(Mandatory = $true)][string]$EventLog,
	[int]$Lines = 200,
	[int]$FirstVisibleLine = 100
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QaScrollHost {
	[DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@

$box = New-Object System.Windows.Forms.TextBox -Property @{
	Multiline = $true; ReadOnly = $true; WordWrap = $false; ScrollBars = 'Vertical'; Dock = 'Fill'
}
$box.Lines = [string[]](1..$Lines | ForEach-Object { 'line {0:D3}' -f $_ })
$form = New-Object System.Windows.Forms.Form -Property @{
	Text = $Title; Width = 420; Height = 320; StartPosition = 'CenterScreen'
}
$form.Controls.Add($box)
function Write-HostEvent([string]$line) { [System.IO.File]::AppendAllText($EventLog, "$line`n") }
$box.Add_MouseWheel({ param($source, $wheel) Write-HostEvent "textbox wheel $($wheel.Delta)" })
$form.Add_MouseWheel({ param($source, $wheel) Write-HostEvent "form wheel $($wheel.Delta)" })
$box.Add_GotFocus({ Write-HostEvent 'textbox focus' })
$form.Add_Activated({ Write-HostEvent "form activated textboxFocused=$($box.Focused)" })
$form.Add_Shown({
	# EM_LINESCROLL down by FirstVisibleLine lines leaves that zero-based line at the top.
	[void][QaScrollHost]::SendMessageW($box.Handle, 0x00B6, [IntPtr]::Zero, [IntPtr]$FirstVisibleLine)
	# EM_POSFROMCHAR of the first characters of two consecutive lines, in the EDIT's client pixels.
	$top = $box.GetPositionFromCharIndex($box.GetFirstCharIndexFromLine($FirstVisibleLine)).Y
	$next = $box.GetPositionFromCharIndex($box.GetFirstCharIndexFromLine($FirstVisibleLine + 1)).Y
	Write-HostEvent "lineHeight $($next - $top)"
	[Console]::Out.WriteLine("ready $($form.Handle.ToInt64())")
	[Console]::Out.Flush()
})
[System.Windows.Forms.Application]::Run($form)
