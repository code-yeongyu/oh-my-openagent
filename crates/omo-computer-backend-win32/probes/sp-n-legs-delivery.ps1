# SP-N delivery legs: foreground and posted barriers, chords, UIPI and the wheel-after-raise race.
# Dot-sourced by sp-n.ps1; each Leg-<name> emits one JSON object through Emit.

function Leg-fg-barrier($a) {
  $top = [IntPtr][int64]$a.top
  $how = [SpN]::Foreground($top)
  if (-not $how) { Emit @{ acquired = $false }; return }
  $runs = @(); $times = New-Object 'System.Collections.Generic.List[double]'
  $c = [char]$a.ch
  for ($i = 0; $i -lt ([int]$a.warm + [int]$a.n); $i++) {
    if ([SpN]::GetForegroundWindow() -ne $top) { [void][SpN]::Foreground($top) }
    $before = CountChar (EffectText $a) $c
    $err = 0
    $t0 = [Diagnostics.Stopwatch]::GetTimestamp()
    $sent = [SpN]::SendChars([string]$c, [ref]$err)
    $routed = [SpN]::Routed()
    $probe = [SpN]::PaintProbe([IntPtr]::Zero, $top)
    $consumed = [SpN]::Consumed($probe)
    $t1 = [Diagnostics.Stopwatch]::GetTimestamp()
    $atReturn = (CountChar (EffectText $a) $c) -gt $before
    $within = if ($atReturn) { $true } else { WaitCount $a $c ($before + 1) 2000 }
    if ($i -ge [int]$a.warm) {
      $times.Add([SpN]::Ms($t1 - $t0))
      $runs += @{ sent = $sent; routed = $routed; consumed = $consumed; atReturn = $atReturn; within2s = $within }
    }
  }
  Emit @{ acquired = $true; acquire = $how; stats = [SpN]::Stats($times); runs = $runs; probeClass = [SpN]::Cls([SpN]::PaintProbe([IntPtr]::Zero, $top)) }
}

function Leg-posted-barrier($a) {
  $top = [IntPtr][int64]$a.top
  if ($a.away) { [void][SpN]::Foreground([IntPtr][int64]$a.away) }
  $dst = if ($a.edit) { [IntPtr][int64]$a.edit } else { [SpN]::FocusOf($top) }
  if ($dst -eq [IntPtr]::Zero) { $dst = $top }
  $runs = @(); $times = New-Object 'System.Collections.Generic.List[double]'
  $c = [char]$a.ch
  for ($i = 0; $i -lt ([int]$a.warm + [int]$a.n); $i++) {
    $before = CountChar (EffectText $a) $c
    $t0 = [Diagnostics.Stopwatch]::GetTimestamp()
    $posted = [SpN]::PostMessageW($dst, 0x102, [IntPtr][int][char]$c, [IntPtr]1)
    $consumed = [SpN]::Consumed([SpN]::PaintProbe($dst, $top))
    $t1 = [Diagnostics.Stopwatch]::GetTimestamp()
    $atReturn = (CountChar (EffectText $a) $c) -gt $before
    $within = if ($atReturn) { $true } else { WaitCount $a $c ($before + 1) 2000 }
    if ($i -ge [int]$a.warm) {
      $times.Add([SpN]::Ms($t1 - $t0))
      $runs += @{ posted = $posted; consumed = $consumed; atReturn = $atReturn; within2s = $within }
    }
  }
  Emit @{ dstClass = [SpN]::Cls($dst); foregroundIsTarget = ([SpN]::GetForegroundWindow() -eq $top); stats = [SpN]::Stats($times); runs = $runs }
}

function Leg-chord($a) {
  $top = [IntPtr][int64]$a.top
  $dst = if ($a.edit) { [IntPtr][int64]$a.edit } else { [SpN]::FocusOf($top) }
  $before = EffectText $a
  if ($a.route -eq 'posted') {
    if ($a.away) { [void][SpN]::Foreground([IntPtr][int64]$a.away) }
    [void][SpN]::PostMessageW($dst, 0x100, [IntPtr]0x11, [IntPtr]0x001D0001)
    [void][SpN]::PostMessageW($dst, 0x100, [IntPtr]0x41, [IntPtr]0x001E0001)
    [void][SpN]::PostMessageW($dst, 0x101, [IntPtr]0x41, [IntPtr]0xC01E0001)
    [void][SpN]::PostMessageW($dst, 0x101, [IntPtr]0x11, [IntPtr]0xC01D0001)
    [void][SpN]::PostMessageW($dst, 0x102, [IntPtr][int][char]'Z', [IntPtr]1)
    $consumed = [SpN]::Consumed([SpN]::PaintProbe($dst, $top))
    $how = 'posted'
  } else {
    $how = [SpN]::Foreground($top)
    if (-not $how) { Emit @{ acquired = $false }; return }
    [void][SpN]::SendChord(0x11, 0x41)
    $err = 0; [void][SpN]::SendChars('Z', [ref]$err)
    $consumed = [SpN]::Routed() -and [SpN]::Consumed([SpN]::PaintProbe([IntPtr]::Zero, $top))
  }
  Start-Sleep -Milliseconds 300
  $after = EffectText $a
  Emit @{ acquired = $true; route = $a.route; acquire = $how; consumed = $consumed; before = $before; after = $after; dstClass = [SpN]::Cls($dst) }
}

function Leg-uipi($a) {
  $top = [IntPtr][int64]$a.top
  $edit = [IntPtr][int64]$a.edit
  $r = @{ integrity = Integrity }
  $how = [SpN]::Foreground($top)
  $r['acquire'] = $how
  $r['foregroundIsTarget'] = ([SpN]::GetForegroundWindow() -eq $top)
  $err = 0
  $r['sendInputReturned'] = [SpN]::SendChars('qqq', [ref]$err)
  $r['sendInputOf'] = 6
  $r['sendInputLastError'] = $err
  [void][SpN]::Routed()
  $r['postReturned'] = [SpN]::PostMessageW($edit, 0x102, [IntPtr][int][char]'w', [IntPtr]1)
  $r['postLastError'] = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  $ok = $false; $code = 0; $rect = New-Object SpN+RECT
  $pf = [SpN]::PrintWin($top, [ref]$ok, [ref]$code, [ref]$rect)
  $r['printWindow'] = [SpN]::Classify($pf); $r['printWindow']['ok'] = $ok; $r['printWindow']['lastError'] = $code
  $info = @{}
  $wf = [SpN]::Wgc($top, [IntPtr]::Zero, 2000, $info)
  $r['wgcWindow'] = [SpN]::Classify($wf); $r['wgcWindow']['info'] = $info
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $el = [Windows.Automation.AutomationElement]::FromHandle($top)
    $r['uiaName'] = $el.Current.Name
    $all = $el.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    $r['uiaDescendants'] = $all.Count
    $editEl = $el.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)))
    if ($editEl) {
      $vp = $null
      if ($editEl.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $r['uiaValue'] = $vp.Current.Value } else { $r['uiaValue'] = $null }
    } else { $r['uiaValue'] = $null }
  } catch { $r['uiaError'] = $_.Exception.Message }
  Emit $r
}

function Leg-wheel($a) {
  $top = [IntPtr][int64]$a.top; $cover = [IntPtr][int64]$a.cover
  $delivered = 0; $runs = [int]$a.n; $acq = @()
  $wr = New-Object SpN+RECT; [void][SpN]::GetWindowRect($top, [ref]$wr)
  $px = [int](($wr.Left + $wr.Right) / 2); $py = [int](($wr.Top + $wr.Bottom) / 2)
  for ($i = 0; $i -lt $runs; $i++) {
    $acq += [SpN]::Foreground($cover)
    [SpN]::Pump(50); [void][SpN]::DwmFlush()
    [void][SpN]::SetCursorPos($px, $py)
    $s = ReadState $a.state; $before = [int]$s.wheel
    [void][SpN]::SetForegroundWindow($top)
    if ($a.mode -eq 'dwmflush') { [void][SpN]::DwmFlush() } else { Start-Sleep -Milliseconds ([int]$a.delayMs) }
    [void][SpN]::Wheel(-1)
    $sw = [Diagnostics.Stopwatch]::StartNew(); $got = $false
    while ($sw.ElapsedMilliseconds -lt 1000) { $s = ReadState $a.state; if ([int]$s.wheel -gt $before) { $got = $true; return }; Start-Sleep -Milliseconds 20 }
    if ($got) { $delivered++ }
  }
  Emit @{ mode = $a.mode; delivered = $delivered; runs = $runs; acquire = ($acq | Select-Object -Unique) }
}
