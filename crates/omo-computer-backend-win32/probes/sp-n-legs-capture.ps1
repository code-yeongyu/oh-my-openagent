# SP-N capture legs: capture classes under session states, the affinity overlay and IsSupported.
# Dot-sourced by sp-n.ps1; each Leg-<name> emits one JSON object through Emit.

# waitFor 'disconnected' / 'locked': the helper starts before the probe changes the session, reads it once
# (before), polls every 100 ms up to waitMs until the session reads WTSDisconnected / WTS_SESSIONSTATE_LOCK
# (the timeline keeps every change it saw), then reads it again right before and after the captures.
function Leg-capture($a) {
  $top = [IntPtr][int64]$a.top
  $sid = [SpN]::OwnSession()
  $r = @{ helperSid = $sid }
  if ($a.waitFor) {
    $r['before'] = SessionRead $sid
    $timeline = New-Object System.Collections.ArrayList
    $sw = [Diagnostics.Stopwatch]::StartNew(); $last = ''; $met = $false
    while ($sw.ElapsedMilliseconds -lt [int]$a.waitMs) {
      $s = SessionRead $sid
      $key = "connect=$($s.connectState) lock=$($s.lock) desktop=$($s.desktop)"
      if ($key -ne $last) { [void]$timeline.Add("$($sw.ElapsedMilliseconds)ms $key"); $last = $key }
      if (($a.waitFor -eq 'disconnected' -and $s.connectState -eq 4) -or ($a.waitFor -eq 'locked' -and $s.lock -eq 'lock')) { $met = $true; break }
      Start-Sleep -Milliseconds 100
    }
    $r['timeline'] = @($timeline); $r['conditionMet'] = $met
  }
  $r['during'] = SessionRead $sid
  $r['connectState'] = $r['during'].connectState; $r['inputDesktop'] = $r['during'].desktop
  $h = $null
  if ($a.displayOff) {
    $h = [SpN]::WatchDisplay(); Start-Sleep -Milliseconds 300
    $r['displayStateBefore'] = [SpN]::DisplayState
    [SpN]::MonitorPower(2)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ([SpN]::DisplayState -ne 0 -and $sw.ElapsedMilliseconds -lt 8000) { Start-Sleep -Milliseconds 50 }
    Start-Sleep -Milliseconds 1500
    $r['displayStateDuring'] = [SpN]::DisplayState
  }
  $ok = $false; $code = 0; $rect = New-Object SpN+RECT
  $pf = [SpN]::PrintWin($top, [ref]$ok, [ref]$code, [ref]$rect)
  $r['printWindow'] = [SpN]::Classify($pf); $r['printWindow']['ok'] = $ok
  $wi = @{}; $r['wgcWindow'] = [SpN]::Classify([SpN]::Wgc($top, [IntPtr]::Zero, 2000, $wi)); $r['wgcWindow']['info'] = $wi
  $mi = @{}; $r['wgcMonitor'] = [SpN]::Classify([SpN]::Wgc([IntPtr]::Zero, [SpN]::MonitorFromWindow($top, 2), 2000, $mi)); $r['wgcMonitor']['info'] = $mi
  $r['duringEnd'] = SessionRead $sid
  $r['connectStateAfter'] = $r['duringEnd'].connectState
  if ($a.displayOff) {
    [SpN]::MonitorPower(-1); [SpN]::ZeroMotion(); [void][SpN]::SetThreadExecutionState(0x2)
    Start-Sleep -Milliseconds 1500
    $r['displayStateAfterWake'] = [SpN]::DisplayState
    [void][SpN]::PowerSettingUnregisterNotification($h)
  }
  Emit $r
}

function Leg-affinity($a) {
  $top = [IntPtr][int64]$a.top
  [void][SpN]::Foreground($top)
  $wr = New-Object SpN+RECT; [void][SpN]::GetWindowRect($top, [ref]$wr)
  $ox = $wr.Left + 60; $oy = $wr.Top + 80; $ow = 160; $oh = 120
  $affOk = $false; [uint32]$affRead = 0
  $ov = [SpN]::Overlay($ox, $oy, $ow, $oh, [bool]$a.exclude, [ref]$affOk, [ref]$affRead)
  $r = @{ exclude = [bool]$a.exclude; setAffinityOk = $affOk; affinityRead = $affRead }
  $hmon = [SpN]::MonitorFromWindow($ov, 2)
  $mi = @{}; $mf = [SpN]::Wgc([IntPtr]::Zero, $hmon, 2000, $mi)
  Add-Type -AssemblyName System.Windows.Forms
  $scr = [System.Windows.Forms.Screen]::FromHandle($ov).Bounds
  $r['wgcMonitor'] = @{ magenta = [SpN]::Magenta($mf, $ox - $scr.X + 8, $oy - $scr.Y + 8, $ox - $scr.X + $ow - 8, $oy - $scr.Y + $oh - 8); info = $mi }
  $ok = $false; $code = 0; $rect = New-Object SpN+RECT
  $pf = [SpN]::PrintWin($top, [ref]$ok, [ref]$code, [ref]$rect)
  $r['printWindow'] = @{ ok = $ok; magenta = [SpN]::Magenta($pf, $ox - $rect.Left + 8, $oy - $rect.Top + 8, $ox - $rect.Left + $ow - 8, $oy - $rect.Top + $oh - 8) }
  $wi = @{}; $wf = [SpN]::Wgc($top, [IntPtr]::Zero, 2000, $wi)
  $r['wgcWindow'] = @{ magenta = [SpN]::Magenta($wf, $ox - $rect.Left + 8, $oy - $rect.Top + 8, $ox - $rect.Left + $ow - 8, $oy - $rect.Top + $oh - 8); info = $wi }
  $br = New-Object SpN+RECT; $br.Left = $ox; $br.Top = $oy; $br.Right = $ox + $ow; $br.Bottom = $oy + $oh
  $r['gdiBitBlt'] = @{ magenta = [SpN]::Magenta([SpN]::ScreenBlt($br), 8, 8, $ow - 8, $oh - 8) }
  [void][SpN]::DestroyWindow($ov)
  Emit $r
}

function Leg-issupported($a) {
  $r = [SpN]::IsSupported(); $r['integrity'] = Integrity; Emit $r
}
