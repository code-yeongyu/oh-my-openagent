# Hosts a minimal WPF window (toolkit class `HwndWrapper[...]`) with a focused TextBox for the
# background-delivery scenario of script/qa/desktop/windows.ts. Prints `ready <hwnd>` once the
# window is rendered and runs until the driver kills it. Run with `powershell.exe -STA`.
param([Parameter(Mandatory = $true)][string]$Title)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
$box = New-Object System.Windows.Controls.TextBox -Property @{ Name = 'qaText'; AcceptsReturn = $true }
$window = New-Object System.Windows.Window -Property @{
	Title = $Title; Width = 420; Height = 240; Content = $box; WindowStartupLocation = 'CenterScreen'
}
$window.Add_ContentRendered({
	[void]$box.Focus()
	$hwnd = (New-Object System.Windows.Interop.WindowInteropHelper -ArgumentList $window).Handle
	[Console]::Out.WriteLine("ready $($hwnd.ToInt64())")
	[Console]::Out.Flush()
})
$app = New-Object System.Windows.Application
[void]$app.Run($window)
