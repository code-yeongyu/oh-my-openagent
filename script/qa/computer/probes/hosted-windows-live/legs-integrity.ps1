# Integrity legs: q1 (a Medium worker beside an elevated fixture) and q5 (the elevation prompt's secure desktop).
# Dot-sourced by hosted-windows-live.ps1. Both arms of q1 run the SAME worker code started through the SAME call
# ([OmoHwl.Token]::Start); only the mandatory label of the worker's token differs. An effect is read only by
# re-reading the fixture's text High-to-High (WM_GETTEXT), never from PostMessage's or SendInput's own return.

$MediumLabel = 'S-1-16-8192'
# PowerShell passes $null to a .NET string parameter as ""; [NullString]::Value is how "keep the caller's label" reaches C#.
$KeepLabel = [NullString]::Value

function Child-Command([string]$leg, [string]$extra) {
	return "`"$PSHOME\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Leg $leg $extra"
}

function New-RunDir {
	return [IO.Directory]::CreateDirectory((Join-Path ([IO.Path]::GetTempPath()) ('omo-hwl-' + [guid]::NewGuid().ToString('N')))).FullName
}

function Wait-File([string]$path, [int]$timeoutMs) {
	$sw = [Diagnostics.Stopwatch]::StartNew()
	while (-not [IO.File]::Exists($path)) {
		if ($sw.ElapsedMilliseconds -gt $timeoutMs) { throw "timed out after $timeoutMs ms waiting for $path" }
		Start-Sleep -Milliseconds 50
	}
	Start-Sleep -Milliseconds 50
	return [IO.File]::ReadAllText($path)
}

function Wait-Exit([int]$id, [int]$timeoutMs) {
	try { $p = [Diagnostics.Process]::GetProcessById($id) } catch { return $true }
	if ($p.WaitForExit($timeoutMs)) { return $true }
	$p.Kill(); [void]$p.WaitForExit(5000)
	return $false
}

function Stop-Child([int]$id) {
	try { $p = [Diagnostics.Process]::GetProcessById($id); $p.Kill(); [void]$p.WaitForExit(5000) } catch { }
	$left = @([Diagnostics.Process]::GetProcesses() | Where-Object { $_.Id -eq $id }).Count
	[Console]::Out.WriteLine("child $id procs $left")
}

# Waits up to $windowMs for each character of $chars in the fixture's text; returns the ms each one landed at, -1 if never.
function Watch-Text([IntPtr]$edit, [string]$chars, [int]$windowMs) {
	$landed = @{}
	foreach ($c in $chars.ToCharArray()) { $landed[[string]$c] = -1 }
	$sw = [Diagnostics.Stopwatch]::StartNew()
	while ($sw.ElapsedMilliseconds -le $windowMs) {
		$text = [OmoHwl.Input]::Text($edit)
		foreach ($c in $chars.ToCharArray()) { if ($landed[[string]$c] -lt 0 -and $text.Contains([string]$c)) { $landed[[string]$c] = $sw.ElapsedMilliseconds } }
		if (@($landed.Values | Where-Object { $_ -lt 0 }).Count -eq 0) { break }
		Start-Sleep -Milliseconds 20
	}
	return $landed
}

function Child-Fixture {
	Add-Type -AssemblyName System.Windows.Forms
	$form = New-Object System.Windows.Forms.Form -Property @{ Text = 'omo-hwl-elevated-fixture'; TopMost = $true; Width = 420; Height = 160 }
	$box = New-Object System.Windows.Forms.TextBox -Property @{ Name = 'probeEdit'; Left = 10; Top = 10; Width = 380 }
	$form.Controls.Add($box)
	$form.Add_Shown({ $form.Activate(); $box.Focus() | Out-Null; [IO.File]::WriteAllText($WorkerOut, "$($form.Handle.ToInt64()) $($box.Handle.ToInt64()) $PID") })
	[System.Windows.Forms.Application]::Run($form)
}

function Child-WorkerInput {
	$edit = [IntPtr][long]$Edit
	$r = @{ label = [OmoHwl.Token]::IntegritySid($PID); postError = [OmoHwl.Input]::PostChar($edit, $Marker[0]); sendCount = [OmoHwl.Input]::SendChar($Marker[1]) }
	[IO.File]::WriteAllText($WorkerOut, ($r | ConvertTo-Json -Compress))
}

function Leg-Elevated {
	Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
	$dir = New-RunDir
	$fixturePid = [OmoHwl.Token]::Start((Child-Command 'fixture' "-WorkerOut `"$dir\fixture.txt`""), $KeepLabel)
	try {
		$parts = (Wait-File "$dir\fixture.txt" 30000).Split(' ')
		$form = [IntPtr][long]$parts[0]; $edit = [IntPtr][long]$parts[1]
		$facts = @{ leg = 'elevated'; run = $Run; fixtureLabel = [OmoHwl.Token]::IntegritySid($fixturePid) }
		$controlMs = 0
		foreach ($arm in @(@{ name = 'control'; label = $KeepLabel; chars = 'ps' }, @{ name = 'medium'; label = $MediumLabel; chars = 'qt' })) {
			[void][OmoHwl.Input]::SetForegroundWindow($form)
			$foreground = [OmoHwl.Input]::GetForegroundWindow() -eq $form
			$out = "$dir\$($arm.name).json"
			$workerPid = [OmoHwl.Token]::Start((Child-Command 'worker-input' "-Edit $($edit.ToInt64()) -Marker $($arm.chars) -WorkerOut `"$out`""), $arm.label)
			$exited = Wait-Exit $workerPid 60000
			$report = (Wait-File $out 5000) | ConvertFrom-Json
			$window = if ($arm.name -eq 'control') { 3000 } else { [Math]::Max(2000, 10 * $controlMs) }
			$landed = Watch-Text $edit $arm.chars $window
			$post = $landed[[string]$arm.chars[0]]; $send = $landed[[string]$arm.chars[1]]
			if ($arm.name -eq 'control') {
				$controlMs = [Math]::Max($post, $send)
				$facts.controlLabel = $report.label
				$facts.control = @{ postLanded = $post -ge 0; sendLanded = $send -ge 0; postMs = $post; sendMs = $send; foreground = $foreground; exited = $exited; postError = $report.postError; sendCount = $report.sendCount }
			} else {
				$facts.workerLabel = $report.label
				$facts.medium = @{ postOk = $report.postError -eq 0; postError = $report.postError; sendCount = $report.sendCount; postLanded = $post -ge 0; sendLanded = $send -ge 0; windowMs = $window; foreground = $foreground; exited = $exited }
			}
		}
		$facts.finalTextLength = ([OmoHwl.Input]::Text($edit)).Length
		Emit $facts
	} finally {
		Stop-Child $fixturePid
		[IO.Directory]::Delete($dir, $true); [Console]::Out.WriteLine("dir REMOVED $dir")
	}
}

function Child-WorkerRunas {
	[IO.File]::WriteAllText("$WorkerOut.label", [OmoHwl.Token]::IntegritySid($PID))
	$r = @{ ok = $false; error = '' }
	try {
		$psi = New-Object Diagnostics.ProcessStartInfo -Property @{ FileName = "$env:SystemRoot\System32\cmd.exe"; Arguments = '/c exit 0'; Verb = 'runas'; UseShellExecute = $true }
		[void][Diagnostics.Process]::Start($psi); $r.ok = $true
	} catch { $r.error = $_.Exception.Message }
	[IO.File]::WriteAllText($WorkerOut, ($r | ConvertTo-Json -Compress))
	Start-Sleep -Milliseconds 3000
}

function Leg-SecureDesktop {
	Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
	$dir = New-RunDir
	$facts = @{ leg = 'secure-desktop'; run = $Run }
	foreach ($p in (Read-Policy).GetEnumerator()) { $facts[$p.Key] = $p.Value }
	$workerPid = [OmoHwl.Token]::Start((Child-Command 'worker-runas' "-WorkerOut `"$dir\runas.json`""), $MediumLabel)
	try {
		$desktops = New-Object Collections.Generic.List[string]
		$consent = $false; $control = $false
		$sw = [Diagnostics.Stopwatch]::StartNew()
		while ($sw.ElapsedMilliseconds -le 6000) {
			$d = [OmoHwl.Session]::InputDesktop(); if ($null -eq $d) { $d = '<unreadable>' }
			if (-not $desktops.Contains($d)) { $desktops.Add($d) }
			$ids = @([Diagnostics.Process]::GetProcesses() | ForEach-Object { $_.Id })
			if ($ids -contains $workerPid) { $control = $true }
			if (@([Diagnostics.Process]::GetProcessesByName('consent')).Count -gt 0) { $consent = $true }
			Start-Sleep -Milliseconds 100
		}
		$facts.workerLabel = (Wait-File "$dir\runas.json.label" 5000)
		$facts.consentSeen = $consent; $facts.controlSeen = $control; $facts.desktops = @($desktops)
		if ([IO.File]::Exists("$dir\runas.json")) { $facts.runas = ([IO.File]::ReadAllText("$dir\runas.json") | ConvertFrom-Json) }
		Emit $facts
	} finally {
		if (@([Diagnostics.Process]::GetProcessesByName('consent')).Count -gt 0) { [void](Invoke-SystemTask "omo-hwl-consent-$PID" "$env:SystemRoot\System32\taskkill.exe /IM consent.exe /F" 15000) }
		Stop-Child $workerPid
		[IO.Directory]::Delete($dir, $true); [Console]::Out.WriteLine("dir REMOVED $dir")
	}
}
