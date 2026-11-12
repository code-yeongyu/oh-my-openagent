# Independent input for the Windows control of the shipped-runtime baseline (legacy-control.ts). It sends input
# through SendInput, outside the tool, and reports what it can see: the foreground window and the control that holds
# keyboard focus, so a control line shows which control a typed key reached.
param(
  [Parameter(Mandatory = $true)][ValidateSet("probe", "focus", "click", "text", "chord")][string]$Do,
  [string]$Window = "",
  [string]$Name = "",
  [int]$X = 0,
  [int]$Y = 0,
  [string]$Text = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ConformanceInput {
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KeyInput { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyInput key; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  static Input Key(ushort vk, ushort scan, uint flags) { var i = new Input { type = 1 }; i.u.key = new KeyInput { vk = vk, scan = scan, flags = flags }; return i; }
  static Input Mouse(uint flags) { var i = new Input { type = 0 }; i.u.mouse = new MouseInput { flags = flags }; return i; }
  static string Send(Input[] inputs) {
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
    return "sent=" + sent + "/" + inputs.Length + " error=" + Marshal.GetLastWin32Error();
  }
  public static string Foreground() { var text = new StringBuilder(256); GetWindowText(GetForegroundWindow(), text, 256); return text.ToString(); }
  public static string Click(int x, int y) { SetCursorPos(x, y); return Send(new[] { Mouse(0x0002), Mouse(0x0004) }); }
  public static string Type(string text) {
    var inputs = new Input[text.Length * 2];
    for (int n = 0; n < text.Length; n++) { inputs[2 * n] = Key(0, text[n], 0x0004); inputs[2 * n + 1] = Key(0, text[n], 0x0004 | 0x0002); }
    return Send(inputs);
  }
  public static string ControlK() { return Send(new[] { Key(0x11, 0, 0), Key(0x4B, 0, 0), Key(0x4B, 0, 0x0002), Key(0x11, 0, 0x0002) }); }
}
"@
[void][ConformanceInput]::SetProcessDPIAware()
$root = [System.Windows.Automation.AutomationElement]::RootElement
$scope = [System.Windows.Automation.TreeScope]

function Find-Named([System.Windows.Automation.AutomationElement]$from, [System.Windows.Automation.TreeScope]$depth, [string]$named) {
  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $named)
  $found = $from.FindFirst($depth, $condition)
  if ($null -eq $found) { throw "no element named '$named'" }
  return $found
}

switch ($Do) {
  "probe" {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $what = if ($null -eq $focused) { "none" } else { "$($focused.Current.ControlType.ProgrammaticName) name='$($focused.Current.Name)' id='$($focused.Current.AutomationId)'" }
    "foreground='$([ConformanceInput]::Foreground())' focused=$what"
  }
  "focus" {
    $win = Find-Named $root $scope::Children $Window
    $element = if ($Name -eq "") { $win } else { Find-Named $win $scope::Descendants $Name }
    $element.SetFocus()
    "focused '$($element.Current.Name)' in '$Window'"
  }
  "click" { [ConformanceInput]::Click($X, $Y) }
  "text" { [ConformanceInput]::Type($Text) }
  "chord" { [ConformanceInput]::ControlK() }
}
