# SP-N measurement legs. probe-sp-n.ts runs one leg per process:
#   powershell -NoProfile -ExecutionPolicy Bypass -File sp-n.ps1 -Leg <leg> [-ArgFile <json file>] [-Out <file>]
# and reads one JSON object (stdout, or -Out when the leg runs in another
# session or at another integrity level). The native calls are the C#
# fragments in sp-n-native-*.ps1; the legs are in sp-n-legs-*.ps1. Nothing
# keeps state between legs except the files under -Out.
param(
  [Parameter(Mandatory = $true)][string]$Leg,
  [string]$ArgFile = '',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'

$SpNNative = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

'@

# The native type comes from sp-n-native.dll beside this file when the workflow precompiled it (-Leg build-native;
# its sha256 is recorded in sp-n-native.dll.sha256), so a leg needs no compiler at run time. The bytes are hashed
# and loaded from one read; a missing record or a mismatch throws (legError). Without the assembly the fragments
# are compiled here, as before.
$NativeDll = Join-Path $PSScriptRoot 'sp-n-native.dll'
$script:NativeFrom = 'not loaded'
function HexSHA256([byte[]]$bytes) {
  $h = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($h.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant() } finally { $h.Dispose() }
}
function Compile {
  if (-not ('SpN' -as [type])) {
    if (Test-Path -LiteralPath $NativeDll) {
      $bytes = [IO.File]::ReadAllBytes($NativeDll)
      $got = HexSHA256 $bytes
      $want = ([IO.File]::ReadAllText("$NativeDll.sha256")).Trim().ToLowerInvariant()
      if ($got -ne $want) { throw "native assembly sha256 mismatch: $NativeDll is $got, recorded $want" }
      [void][Reflection.Assembly]::Load($bytes)
      $script:NativeFrom = "precompiled sha256=$got"
    } else {
      Add-Type -TypeDefinition $SpNNative -Language CSharp
      $script:NativeFrom = 'Add-Type at run time (no precompiled assembly)'
    }
  }
  [void][SpN]::SetProcessDpiAwarenessContext([IntPtr](-4))
}
# -Leg build-native: compile the fragments once into sp-n-native.dll and record its sha256 beside it.
function BuildNative {
  foreach ($p in $NativeDll, "$NativeDll.sha256") { if (Test-Path -LiteralPath $p) { Remove-Item -Force -LiteralPath $p } }
  Add-Type -TypeDefinition $SpNNative -Language CSharp -OutputAssembly $NativeDll -OutputType Library
  $sha = HexSHA256 ([IO.File]::ReadAllBytes($NativeDll))
  [IO.File]::WriteAllText("$NativeDll.sha256", $sha)
  Emit @{ built = $NativeDll; sha256 = $sha }
}

function Emit([hashtable]$r) {
  $r['leg'] = $Leg
  $r['native'] = $script:NativeFrom
  # a setup error is emitted before the native type exists
  $r['sessionId'] = if ('SpN' -as [type]) { [SpN]::OwnSession() } else { $null }
  $json = $r | ConvertTo-Json -Depth 8 -Compress
  if ($Out) {
    [IO.File]::WriteAllText("$Out.tmp", $json)
    if (Test-Path $Out) { Remove-Item -Force $Out }
    Move-Item -Force "$Out.tmp" $Out
  } else { [Console]::Out.WriteLine($json) }
}

function Integrity {
  $line = (whoami /groups /fo csv | ConvertFrom-Csv | Where-Object { $_.'Group Name' -like 'Mandatory Label\*' } | Select-Object -First 1).'Group Name'
  if ($line) { return ($line -replace '^Mandatory Label\\', '' -replace ' Mandatory Level$', '').ToLowerInvariant() }
  return 'unknown'
}

function HostFacts {
  $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  Add-Type -AssemblyName System.Windows.Forms
  $groups = whoami /groups /fo csv | ConvertFrom-Csv
  $adminGroup = $groups | Where-Object { $_.SID -eq 'S-1-5-32-544' } | Select-Object -First 1
  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  $screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ primary = $_.Primary; w = $_.Bounds.Width; h = $_.Bounds.Height; x = $_.Bounds.X; y = $_.Bounds.Y; dpi = [SpN]::MonitorDpi($_.Bounds.X, $_.Bounds.Y) } })
  $sid = [SpN]::OwnSession()
  return @{
    build = "$($cv.CurrentMajorVersionNumber).$($cv.CurrentMinorVersionNumber).$($cv.CurrentBuild).$($cv.UBR)"
    displayVersion = $cv.DisplayVersion
    arch = $env:PROCESSOR_ARCHITECTURE
    inAdministrators = [bool]$adminGroup
    administratorsAttributes = if ($adminGroup) { $adminGroup.Attributes } else { '' }
    elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    integrity = Integrity
    inputDesktop = [SpN]::InputDesktop()
    connectState = $(try { [SpN]::ConnectState($sid) } catch { "error: $($_.Exception.Message)" })
    consoleSessionId = [SpN]::WTSGetActiveConsoleSessionId()
    monitors = $screens
    monitorCount = $screens.Count
    github = [bool]$env:GITHUB_ACTIONS
  }
}

# A target's state file: @{ ok = $true; state } or @{ ok = $false; error }, never $null. A read can race the
# target's rename, so it retries; the last error is kept and returned, never dropped.
function ReadState([string]$path) {
  $last = 'not written'
  for ($i = 0; $i -lt 20; $i++) {
    try {
      if (Test-Path -LiteralPath $path) {
        $s = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
        if ($null -ne $s) { return @{ ok = $true; state = $s } }
        $last = 'empty file'
      }
    } catch { $last = $_.Exception.Message }
    Start-Sleep -Milliseconds 25
  }
  return @{ ok = $false; error = "$path : $last" }
}

# Effect oracle per target: the target's own state file, or WM_GETTEXT on Notepad's edit. A failed read throws,
# so the leg reports legError and its rows are UNMEASURED; it is never counted as "no effect".
function EffectText($t) {
  if ($t.state) {
    $r = ReadState $t.state
    if (-not $r.ok) { throw "state read failed: $($r.error)" }
    return [string]$r.state.text
  }
  # WM_GETTEXT first; if it fails (a null or foreign edit handle), UI Automation on the same control; if both
  # fail, the leg fails with both reasons and its rows are UNMEASURED. A failed read is never "no effect".
  $h = [IntPtr][int64]$t.edit
  $w = [SpN]::TextOf($h)
  if ($w.ok) { return [string]$w.text }
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $el = [Windows.Automation.AutomationElement]::FromHandle($h)
    $p = $null
    if ($el.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { return [string]$p.Current.Value }
    if ($el.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$p)) { return [string]$p.DocumentRange.GetText(-1) }
    $uia = 'the control exposes neither ValuePattern nor TextPattern'
  } catch { $uia = $_.Exception.Message }
  throw "edit text unreadable: WM_GETTEXT: $($w.error); UI Automation: $uia"
}

# One read of a session's state: connect state, lock flag and input desktop, each with its own error text.
function SessionRead([uint32]$sid) {
  $l = [SpN]::SessionLock($sid)
  $c = try { [SpN]::ConnectState($sid) } catch { "error: $($_.Exception.Message)" }
  return @{ connectState = $c; lock = $(if ($l.error) { "error: $($l.error)" } else { $l.flags }); lockSession = $l.sessionId; desktop = [SpN]::InputDesktop() }
}
function WheelCount([string]$path) {
  $r = ReadState $path
  if (-not $r.ok) { throw "state read failed: $($r.error)" }
  if ($null -eq $r.state.wheel) { throw "state has no wheel counter: $path" }
  return [int]$r.state.wheel
}
function CountChar([string]$s, [char]$c) { return @($s.ToCharArray() | Where-Object { $_ -eq $c }).Count }
function WaitCount($t, [char]$c, [int]$want, [int]$ms) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  do { if ((CountChar (EffectText $t) $c) -ge $want) { return $true }; Start-Sleep -Milliseconds 10 } while ($sw.ElapsedMilliseconds -lt $ms)
  return $false
}

# Setup runs in the handled path: a failure here (a fragment, the start marker, the argument file, the native
# type) reports legError with its line, so the probe records the rows UNMEASURED with that text, never a timeout
# (hosted run 43220783638: Add-Type threw in a restricted process and the helper exited without a word). The
# start marker lets the probe tell a helper that never started from one that exited without a result.
try {
  if ($Out) { [IO.File]::WriteAllText("$Out.started", (@{ pid = $PID } | ConvertTo-Json -Compress)) }
  foreach ($f in 'win32', 'input', 'capture') { . (Join-Path $PSScriptRoot "sp-n-native-$f.ps1") }
  foreach ($f in 'delivery', 'capture', 'session') { . (Join-Path $PSScriptRoot "sp-n-legs-$f.ps1") }
  $a = if ($ArgFile) { Get-Content -Raw $ArgFile | ConvertFrom-Json } else { [pscustomobject]@{} }
  if ($Leg -eq 'build-native') { BuildNative; exit 0 }
  Compile
} catch { Emit @{ legError = "setup failed: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }; exit 1 }

if (-not (Get-Command "Leg-$Leg" -ErrorAction SilentlyContinue)) { [Console]::Error.WriteLine("unknown leg $Leg"); exit 2 }
# A leg that throws reports legError (with the line), which the probe raises; it never reads as a result.
try { & "Leg-$Leg" $a } catch { Emit @{ legError = "$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }; exit 1 }
