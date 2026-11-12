# Facts collector for the Windows live tier's five hosted-runner questions (q1 elevated, q2 lock, q3 disconnect,
# q4 mixed-dpi, q5 secure-desktop). Each -Leg appends ONE JSON line of raw observations to -Out; it never decides a
# verdict. script/qa/computer/pool/windows-full.ts reads the lines and owns every verdict rule.
# Windows PowerShell 5.1; natives are compiled once from hosted-windows-live/*.cs. The legs lock, disconnect and
# install a display driver, so run them only on a disposable runner, never in a person's session.
param(
	[Parameter(Mandatory = $true)][string]$Leg,
	[string]$Out = '',
	[int]$Run = 1,
	[string]$WorkerOut = '',
	[string]$Edit = '0',
	[string]$Marker = '',
	[int]$HoldMs = 8000,
	[string]$VddZip = '',
	[string]$VddSha256 = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Inside a function of a dot-sourced file $PSCommandPath names that file, so children are started from $Entry.
$Entry = $PSCommandPath
$Here = Join-Path $PSScriptRoot 'hosted-windows-live'
$NativeSources = @((Join-Path $Here 'native-session.cs'), (Join-Path $Here 'native-display.cs'))
# A Medium child cannot compile (Add-Type fails with 'a required privilege is not held'), so a parent leg compiles the
# natives once into its run directory and its children load that library instead.
if ($env:OMO_HWL_NATIVE_DLL -and [IO.File]::Exists($env:OMO_HWL_NATIVE_DLL)) {
	# Loaded from bytes: LoadFrom on a file under the run's temp directory fails with 0x80131515 on the runner.
	[void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes($env:OMO_HWL_NATIVE_DLL))
} else {
	Add-Type -Path $NativeSources
}
. (Join-Path $Here 'legs-session.ps1')
. (Join-Path $Here 'legs-integrity.ps1')
. (Join-Path $Here 'legs-display.ps1')

function Emit($fields) {
	$line = ($fields | ConvertTo-Json -Compress -Depth 8)
	if ($Out) { [IO.File]::AppendAllText($Out, $line + "`n", (New-Object Text.UTF8Encoding $false)) }
	[Console]::Out.WriteLine($line)
}

# The same script is the child for the fixture and the workers; they report through -WorkerOut, not -Out.
$legs = @{
	'facts' = { Leg-Facts }
	'disconnect' = { Leg-Disconnect }
	'lock' = { Leg-Lock }
	'elevated' = { Leg-Elevated }
	'secure-desktop' = { Leg-SecureDesktop }
	'mixed-dpi' = { Leg-MixedDpi }
	'fixture' = { Child-Fixture }
	'worker-input' = { Child-WorkerInput }
	'worker-runas' = { Child-WorkerRunas }
	'dpi-read' = { Child-DpiRead }
}
if (-not $legs.ContainsKey($Leg)) { throw "unknown leg '$Leg' (known: $(($legs.Keys | Sort-Object) -join ', '))" }
if (-not $Out -and -not $Leg.StartsWith('fixture') -and -not $Leg.StartsWith('worker') -and $Leg -ne 'dpi-read') { throw "-Out is required for leg '$Leg'" }
# A leg that throws is still a measurement: its error becomes the fact (the ledger reads it UNMEASURED) and the step
# succeeds once that fact is written. A child, or a failure to write the fact, still fails the step.
try {
	& $legs[$Leg]
} catch {
	if (-not $Out) {
		if ($WorkerOut) { [IO.File]::WriteAllText("$WorkerOut.err", ($_ | Out-String)) }
		throw
	}
	$message = $_.Exception.Message
	Emit @{ leg = $Leg; run = $Run; error = $message }
	[Console]::Out.WriteLine("LEG_ERROR leg=$Leg run=$Run recorded: $message")
}
# The legs end on native calls that may exit non-zero by design (schtasks /Query on a task just deleted); the CI shell
# wrapper exits with $LASTEXITCODE, so the script sets it once the fact is written.
exit 0
