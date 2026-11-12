# SP-N host and session legs: preconditions, host facts, timers, window lookup, disconnect and lock.
# Dot-sourced by sp-n.ps1; each Leg-<name> emits one JSON object through Emit.

function Leg-precondition($a) {
  $sid = [SpN]::OwnSession()
  $desk = [SpN]::InputDesktop()
  $ok = ($sid -ne 0) -and ($null -ne $desk)
  Emit @{ ok = $ok; inputDesktop = $desk; reason = if ($sid -eq 0) { 'session id is 0 (no interactive desktop)' } elseif ($null -eq $desk) { 'OpenInputDesktop failed' } else { '' } }
  if (-not $ok) { [Console]::Error.WriteLine("PRECONDITION interactive-desktop: OpenInputDesktop=$desk sessionId=$sid"); exit 3 }
}

function Leg-facts($a) {
  Emit (HostFacts)
}

function Leg-dwmflush($a) {
  Emit @{ stats = [SpN]::DwmFlushTimes([int]$a.warm, [int]$a.n) }
}

function Leg-sleep($a) {
  Emit @{ sleep1 = [SpN]::SleepTimes([int]$a.warm, [int]$a.n, $false); hrtimer1 = [SpN]::SleepTimes([int]$a.warm, [int]$a.n, $true) }
}

function Leg-find($a) {
  $exclude = @($a.exclude | ForEach-Object { [int64]$_ })
  $all = New-Object System.Collections.ArrayList
  $cb = [SpN+EnumProc] { param($h, $lp)
    if ([SpN]::IsWindowVisible($h)) {
      $ok = if ($a.title) { [SpN]::Text($h) -eq $a.title } else { [SpN]::Cls($h) -eq $a.cls }
      if ($ok) { [void]$all.Add([int64]$h) }
    }
    return $true }
  [void][SpN]::EnumWindows($cb, [IntPtr]::Zero)
  $pick = $all | Where-Object { $exclude -notcontains $_ } | Select-Object -First 1
  $r = @{ all = @($all); top = $pick }
  if ($pick) {
    $r['classes'] = [SpN]::ChildClasses([IntPtr]$pick)
    if ($a.child) { $r['edit'] = [int64][SpN]::FindChild([IntPtr]$pick, $a.child) }
    $p = [uint32]0; [void][SpN]::GetWindowThreadProcessId([IntPtr]$pick, [ref]$p); $r['pid'] = $p
  }
  Emit $r
}

# The shared directory's ACL as SIDs, read in this leg so no PowerShell code travels on a command line.
function Leg-acl($a) {
  $acl = (Get-Item -LiteralPath $a.path -Force).GetAccessControl('Owner, Access')
  $sids = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
  Emit @{ owner = $(if ($owner) { $owner.Value } else { '' }); sids = ($sids -join ','); sddl = $acl.Sddl }
}

function Leg-close($a) {
  Emit @{ posted = [SpN]::PostMessageW([IntPtr][int64]$a.top, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
}

function Leg-disconnect($a) {
  $err = 0
  $ok = [SpN]::DisconnectOwn([ref]$err)
  Emit @{ disconnected = $ok; lastError = $err }
}

function Leg-lock($a) {
  Emit @{ locked = [SpN]::LockWorkStation() }
}

function Leg-disconnect-state($a) {
  Emit @{ connectState = [SpN]::ConnectState([uint32]$a.sid); inputDesktop = [SpN]::InputDesktop() }
}
