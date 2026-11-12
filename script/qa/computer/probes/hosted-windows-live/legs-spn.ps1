# Host conditions for running the Windows spike's own probe (SP-N) unmodified on the hosted runner. Dot-sourced by
# hosted-windows-live.ps1. sp-n-prepare builds a runas.exe stand-in (runas-shim.cs) whose children run at Medium, and
# adds a second monitor through the pinned display driver; sp-n-cleanup removes the monitor and the certificate again.
# Neither leg reads or writes the spike's files; its probe and ledger are its own.

function Leg-SpnPrepare {
	if (-not $WorkerOut) { throw 'sp-n-prepare needs -WorkerOut <state directory>' }
	if (-not $VddSha256) { throw '-VddSha256 is required: the driver package is never installed unpinned' }
	$dir = [IO.Directory]::CreateDirectory($WorkerOut).FullName
	$shimDir = [IO.Directory]::CreateDirectory((Join-Path $dir 'shim')).FullName
	$options = New-Object CodeDom.Compiler.CompilerParameters
	$options.OutputAssembly = Join-Path $shimDir 'runas.exe'; $options.GenerateExecutable = $true; $options.GenerateInMemory = $false
	$options.MainClass = 'RunasShim'; [void]$options.ReferencedAssemblies.Add('System.dll')
	$sources = [string[]]@((Join-Path $Here 'native-session.cs'), (Join-Path $Here 'runas-shim.cs'))
	$result = (New-Object Microsoft.CSharp.CSharpCodeProvider).CompileAssemblyFromFile($options, $sources)
	if ($result.Errors.HasErrors) { throw "runas shim did not compile: $(($result.Errors | ForEach-Object { $_.ToString() }) -join '; ')" }
	$install = @{ downloadOk = $false; sha256 = ''; certThumbprint = ''; certOk = $false; deviceOk = $false; driverOk = $false; instanceId = ''; error = '' }
	$state = @{ shimDir = $shimDir; install = $install }
	try {
		$before = @([OmoHwl.Display]::Monitors()).Count
		Install-Vdd $dir $install 'C:\VirtualDisplayDriver'
		$sw = [Diagnostics.Stopwatch]::StartNew()
		while ($sw.ElapsedMilliseconds -lt 30000 -and @([OmoHwl.Display]::Monitors()).Count -le $before) { Start-Sleep -Milliseconds 500 }
		$secondary = @([OmoHwl.Display]::Monitors() | Where-Object { -not $_.primary }) | Select-Object -First 1
		if ($null -ne $secondary) { $state.mode = [OmoHwl.Display]::SetLargestMode([string]$secondary.device) }
		$state.monitors = @([OmoHwl.Display]::Monitors()).Count
	} finally {
		[IO.File]::WriteAllText((Join-Path $dir 'state.json'), ($state | ConvertTo-Json -Compress -Depth 4))
	}
	[Console]::Out.WriteLine("SPN_PREPARED shim=$shimDir\runas.exe monitors=$($state.monitors) mode=$($state.mode) device=$($install.instanceId)")
}

function Leg-SpnCleanup {
	$state = [IO.File]::ReadAllText((Join-Path $WorkerOut 'state.json')) | ConvertFrom-Json
	[void](Remove-Vdd ([string]$state.install.instanceId) ([string]$state.install.certThumbprint) 'C:\VirtualDisplayDriver')
	[Console]::Out.WriteLine("SPN_CLEANED monitors=$(@([OmoHwl.Display]::Monitors()).Count)")
}
