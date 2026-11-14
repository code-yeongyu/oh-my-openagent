# A per-monitor-v2 aware, borderless, topmost WinForms window split into four colour quadrants.
# Prints one JSON line on stdout once it is shown: its HWND, its client rectangle in physical
# screen pixels and its monitor DPI, read by this process (the observer), not by the engine.
# Closes when a line arrives on stdin.
param([int]$X = 200, [int]$Y = 200, [int]$Size = 400)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MarkerNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
}
'@
[void][MarkerNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = "omo-cu-marker-$PID"
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.Bounds = New-Object System.Drawing.Rectangle($X, $Y, $Size, $Size)
$half = [int]($Size / 2)
$colours = @(@(255, 0, 0), @(0, 255, 0), @(0, 0, 255), @(255, 255, 0))
for ($i = 0; $i -lt 4; $i++) {
  $panel = New-Object System.Windows.Forms.Panel
  $panel.Bounds = New-Object System.Drawing.Rectangle((($i % 2) * $half), ([math]::Floor($i / 2) * $half), $half, $half)
  $c = $colours[$i]
  $panel.BackColor = [System.Drawing.Color]::FromArgb($c[0], $c[1], $c[2])
  $form.Controls.Add($panel)
}
$form.Add_Shown({
  $form.Refresh()
  $hwnd = $form.Handle
  $rect = New-Object MarkerNative+RECT
  [void][MarkerNative]::GetClientRect($hwnd, [ref]$rect)
  $origin = New-Object MarkerNative+POINT
  [void][MarkerNative]::ClientToScreen($hwnd, [ref]$origin)
  $ready = @{ title = $form.Text; hwnd = [int64]$hwnd; x = $origin.X; y = $origin.Y; width = $rect.Right; height = $rect.Bottom; dpi = [MarkerNative]::GetDpiForWindow($hwnd); colours = $colours }
  [Console]::Out.WriteLine(($ready | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
  $reader = [System.Threading.Tasks.Task]::Run([Func[string]]{ [Console]::In.ReadLine() })
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 50
  $timer.Add_Tick({ if ($reader.IsCompleted) { $form.Close() } })
  $timer.Start()
})
[System.Windows.Forms.Application]::Run($form)
