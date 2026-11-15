# Session legs: host facts, disconnect (q3) and lock (q2). Dot-sourced by hosted-windows-live.ps1.
# A state counts only when read: WTSConnectState for disconnected, the WTSSessionInfoEx lock flag for locked. The
# restore is a SYSTEM scheduled task (tscon <session> /dest:console); the session counts as restored only when the
# reads after it say connected, unlocked and input desktop Default.

function Read-Policy {
	$key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System')
	$read = { param($name) $v = $key.GetValue($name, $null); if ($null -eq $v) { -1 } else { [int]$v } }
	return @{ enableLua = (& $read 'EnableLUA'); promptOnSecureDesktop = (& $read 'PromptOnSecureDesktop'); consentPromptBehaviorAdmin = (& $read 'ConsentPromptBehaviorAdmin') }
}

function Leg-Facts {
	$sid = [OmoHwl.Session]::Own()
	$desk = [OmoHwl.Session]::InputDesktop()
	$cv = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SOFTWARE\Microsoft\Windows NT\CurrentVersion')
	$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
	$facts = @{
		leg = 'facts'; run = $Run; sessionId = $sid; inputDesktop = $desk
		product = [string]$cv.GetValue('ProductName'); build = "$($cv.GetValue('CurrentBuild')).$($cv.GetValue('UBR'))"
		ownIntegrity = [OmoHwl.Token]::IntegritySid($PID); admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
		monitors = @([OmoHwl.Display]::Monitors()).Count; pointerSize = [IntPtr]::Size
	}
	foreach ($p in (Read-Policy).GetEnumerator()) { $facts[$p.Key] = $p.Value }
	Emit $facts
	$kind = if ($sid -ne 0 -and $null -ne $desk) { 'interactive' } else { 'noninteractive' }
	[Console]::Out.WriteLine("session=$kind id=$sid desktop=$desk")
	if ($kind -ne 'interactive') { exit 3 }
}

# Runs $command once as SYSTEM through the task scheduler and returns its Last Result (or a negative code when the
# task never reported one). The task is always deleted, and its absence is read back.
function Invoke-SystemTask([string]$name, [string]$command, [int]$timeoutMs) {
	# Windows PowerShell 5.1 turns a native command's redirected stderr into a terminating error under Stop; the
	# exit codes below are the result, so this function reads them with Continue.
	$ErrorActionPreference = 'Continue'
	& schtasks.exe /Create /TN $name /TR $command /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F | Out-Null
	if ($LASTEXITCODE -ne 0) { return -1 }
	try {
		& schtasks.exe /Run /TN $name | Out-Null
		$sw = [Diagnostics.Stopwatch]::StartNew()
		while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
			$rows = & schtasks.exe /Query /TN $name /FO CSV /V | ConvertFrom-Csv
			$row = @($rows)[0]
			if ($null -eq $row) { Start-Sleep -Milliseconds 200; continue }
			# 267009 (0x41301) is 'currently running' and 267011 (0x41303) 'has not yet run': neither is a result.
			if ($row.Status -ne 'Running' -and $row.'Last Result' -notin @('267009', '267011')) { return [int]$row.'Last Result' }
			Start-Sleep -Milliseconds 200
		}
		return -2
	} finally {
		& schtasks.exe /Delete /TN $name /F | Out-Null
		& schtasks.exe /Query /TN $name 2>$null | Out-Null
		if ($LASTEXITCODE -eq 0) { [Console]::Error.WriteLine("hosted-windows-live: task $name LEFT") } else { [Console]::Out.WriteLine("task $name REMOVED") }
	}
}

function Restore-Session([uint32]$sid) {
	$result = Invoke-SystemTask "omo-hwl-restore-$PID" "$env:SystemRoot\System32\tscon.exe $sid /dest:console" 15000
	$after = [OmoHwl.Session]::Read($sid, 0)
	$sw = [Diagnostics.Stopwatch]::StartNew()
	while ($sw.ElapsedMilliseconds -lt 10000 -and -not ($after.connect -eq 0 -and $after.lock -eq 1 -and $after.desktop -eq 'Default')) {
		Start-Sleep -Milliseconds 200
		$after = [OmoHwl.Session]::Read($sid, $sw.ElapsedMilliseconds)
	}
	return @{ taskResult = $result; after = $after }
}

function Leg-Disconnect {
	$sid = [OmoHwl.Session]::Own()
	$before = [OmoHwl.Session]::Read($sid, 0)
	$err = [OmoHwl.Session]::DisconnectOwn()
	$timeline = [OmoHwl.Session]::Poll($sid, $HoldMs + 500, 100)
	Emit @{ leg = 'disconnect'; run = $Run; sessionId = $sid; before = $before; disconnectError = $err; holdTargetMs = $HoldMs; timeline = @($timeline); restore = (Restore-Session $sid) }
}

function Leg-Lock {
	$sid = [OmoHwl.Session]::Own()
	$before = [OmoHwl.Session]::Read($sid, 0)
	$ok = [OmoHwl.Session]::LockWorkStation()
	$timeline = [OmoHwl.Session]::Poll($sid, $HoldMs, 100)
	Emit @{ leg = 'lock'; run = $Run; sessionId = $sid; before = $before; lockCalled = $ok; holdTargetMs = $HoldMs; timeline = @($timeline); restore = (Restore-Session $sid) }
}
