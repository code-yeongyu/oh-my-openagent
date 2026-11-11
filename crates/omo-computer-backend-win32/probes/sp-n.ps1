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
foreach ($f in 'win32', 'input', 'capture') { . (Join-Path $PSScriptRoot "sp-n-native-$f.ps1") }
foreach ($f in 'delivery', 'capture', 'session') { . (Join-Path $PSScriptRoot "sp-n-legs-$f.ps1") }

function Compile {
  if (-not ('SpN' -as [type])) { Add-Type -TypeDefinition $SpNNative -Language CSharp }
  [void][SpN]::SetProcessDpiAwarenessContext([IntPtr](-4))
}

function Emit([hashtable]$r) {
  $r['leg'] = $Leg
  $r['sessionId'] = [SpN]::OwnSession()
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
  $screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ primary = $_.Primary; w = $_.Bounds.Width; h = $_.Bounds.Height; x = $_.Bounds.X; y = $_.Bounds.Y } })
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
    connectState = [SpN]::ConnectState($sid)
    consoleSessionId = [SpN]::WTSGetActiveConsoleSessionId()
    monitors = $screens
    monitorCount = $screens.Count
    github = [bool]$env:GITHUB_ACTIONS
  }
}

function ReadState([string]$path) {
  for ($i = 0; $i -lt 20; $i++) {
    try { if (Test-Path $path) { return Get-Content -Raw $path | ConvertFrom-Json } } catch { }
    Start-Sleep -Milliseconds 25
  }
  return $null
}

# Effect oracle per target: the target's own state file, or WM_GETTEXT on Notepad's edit.
function EffectText($t) {
  if ($t.state) { $s = ReadState $t.state; if ($s) { return [string]$s.text } ; return $null }
  return [SpN]::GetTextOf([IntPtr][int64]$t.edit)
}
function CountChar([string]$s, [char]$c) { if ($null -eq $s) { return -1 }; return ($s.ToCharArray() | Where-Object { $_ -eq $c }).Count }
function WaitCount($t, [char]$c, [int]$want, [int]$ms) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  do { if ((CountChar (EffectText $t) $c) -ge $want) { return $true }; Start-Sleep -Milliseconds 10 } while ($sw.ElapsedMilliseconds -lt $ms)
  return $false
}

$a = if ($ArgFile) { Get-Content -Raw $ArgFile | ConvertFrom-Json } else { [pscustomobject]@{} }
Compile

if (-not (Get-Command "Leg-$Leg" -ErrorAction SilentlyContinue)) { [Console]::Error.WriteLine("unknown leg $Leg"); exit 2 }
& "Leg-$Leg" $a
