# Display leg q4: add a second monitor through an indirect display driver and set it to 150 %. Dot-sourced by
# hosted-windows-live.ps1. Every DPI read happens in a FRESH per-monitor-aware child (dpi-read), so neither this
# process's awareness nor a cached DPI can stand in for the effective value.
# Driver: VirtualDrivers/Virtual-Display-Driver release 24.10.27 (MIT), pinned by sha256 through -VddSha256; its
# self-signed catalog certificate is trusted for the run and removed again, as is the device node.

$VddUrl = 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/24.10.27/VirtualDisplayDriver-x64.zip'
$VddHwid = 'Root\MttVDD'
$DisplayClass = [guid]'4d36e968-e325-11ce-bfc1-08002be10318'

function Child-DpiRead {
	$aw = [OmoHwl.Display]::MakePerMonitorAware()
	[IO.File]::WriteAllText($WorkerOut, (@{ awareness = $aw; monitors = @([OmoHwl.Display]::Monitors()) } | ConvertTo-Json -Compress -Depth 4))
}

function Read-Dpi([string]$dir) {
	$dpiPath = Join-Path $dir ('dpi-' + [guid]::NewGuid().ToString('N') + '.json')
	$id = [OmoHwl.Token]::Start((Child-Command 'dpi-read' $dpiPath), $KeepLabel)
	[void](Wait-Exit $id 30000)
	return ((Wait-File $dpiPath 5000 $dpiPath) | ConvertFrom-Json)
}

function Get-Sha256([string]$path) {
	$sha = [Security.Cryptography.SHA256]::Create()
	$s = [IO.File]::OpenRead($path)
	try { return (-join ($sha.ComputeHash($s) | ForEach-Object { $_.ToString('x2') })) } finally { $s.Dispose(); $sha.Dispose() }
}

# Downloads the pinned driver package, trusts its catalog certificate, writes its settings and creates the root device.
# Fills $install step by step; its certThumbprint is recorded before any store is touched, so cleanup can always find it.
function Install-Vdd([string]$dir, [hashtable]$install, [string]$settingsDir) {
	$zip = if ($VddZip) { $VddZip } else {
		[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
		(New-Object Net.WebClient).DownloadFile($VddUrl, "$dir\vdd.zip"); "$dir\vdd.zip"
	}
	$install.sha256 = Get-Sha256 $zip
	if ($install.sha256 -ne $VddSha256.ToLowerInvariant()) { throw "driver package sha256 $($install.sha256) is not the pinned $VddSha256" }
	$install.downloadOk = $true
	Add-Type -AssemblyName System.IO.Compression.FileSystem
	[IO.Compression.ZipFile]::ExtractToDirectory($zip, "$dir\vdd")
	$pkg = Join-Path $dir 'vdd\VirtualDisplayDriver'
	$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2("$pkg\Virtual_Display_Driver.cer")
	$install.certThumbprint = $cert.Thumbprint
	foreach ($name in @('Root', 'TrustedPublisher')) {
		$store = New-Object Security.Cryptography.X509Certificates.X509Store($name, 'LocalMachine'); $store.Open('ReadWrite'); $store.Add($cert); $store.Close()
	}
	$install.certOk = $true
	[void][IO.Directory]::CreateDirectory($settingsDir)
	[IO.File]::Copy("$pkg\vdd_settings.xml", "$settingsDir\vdd_settings.xml", $true)
	$install.instanceId = [OmoHwl.Devices]::CreateRoot('Display', $DisplayClass, $VddHwid)
	$install.deviceOk = $true
	$update = [OmoHwl.Devices]::UpdateDriver($VddHwid, "$pkg\MttVDD.inf")
	$install.error = $update
	$install.driverOk = ($update -eq '' -or $update -eq 'reboot')
}

function Leg-MixedDpi {
	Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
	if (-not $VddSha256) { throw '-VddSha256 is required: the driver package is never installed unpinned' }
	$dir = New-RunDir
	$install = @{ downloadOk = $false; sha256 = ''; certThumbprint = ''; certOk = $false; deviceOk = $false; driverOk = $false; instanceId = ''; error = '' }
	$facts = @{ leg = 'mixed-dpi'; run = $Run; install = $install }
	$settingsDir = 'C:\VirtualDisplayDriver'
	try {
		$facts.monitorsBefore = @((Read-Dpi $dir).monitors)
		Install-Vdd $dir $install $settingsDir
		$read = Read-Dpi $dir
		$sw = [Diagnostics.Stopwatch]::StartNew()
		while ($sw.ElapsedMilliseconds -lt 30000 -and @($read.monitors).Count -le @($facts.monitorsBefore).Count) { Start-Sleep -Milliseconds 500; $read = Read-Dpi $dir }
		$secondary = @($read.monitors | Where-Object { -not $_.primary }) | Select-Object -First 1
		if ($null -ne $secondary) {
			$facts.mode = [OmoHwl.Display]::SetLargestMode([string]$secondary.device)
			Start-Sleep -Milliseconds 1500
			$facts.setScale = [OmoHwl.Display]::SetScale([string]$secondary.device, 150)
			$sw.Restart()
			do { Start-Sleep -Milliseconds 500; $read = Read-Dpi $dir } while ($sw.ElapsedMilliseconds -lt 10000 -and -not @($read.monitors | Where-Object { -not $_.primary -and $_.dpi -eq 144 }))
		}
		$facts.awareness = $read.awareness
		$facts.monitors = @($read.monitors)
	} catch {
		$facts.error = $_.Exception.Message
	} finally {
		$facts.cleanup = Remove-Vdd $install.instanceId $install.certThumbprint $settingsDir
		[IO.Directory]::Delete($dir, $true); [Console]::Out.WriteLine("dir REMOVED $dir")
	}
	Emit $facts
}

function Remove-Vdd([string]$instanceId, [string]$thumbprint, [string]$settingsDir) {
	$ErrorActionPreference = 'Continue'
	$receipts = @()
	if ($instanceId) {
		$text = (& pnputil.exe /remove-device $instanceId 2>&1 | Out-String).Trim()
		$receipts += "device $instanceId remove rc=$LASTEXITCODE"
		if ($LASTEXITCODE -ne 0) { $receipts += "pnputil: $text" }
	}
	if ($thumbprint) {
		foreach ($name in @('Root', 'TrustedPublisher')) {
			$store = New-Object Security.Cryptography.X509Certificates.X509Store($name, 'LocalMachine'); $store.Open('ReadWrite')
			@($store.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint }) | ForEach-Object { $store.Remove($_) }
			$left = @($store.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint }).Count; $store.Close()
			$receipts += "cert $name left=$left"
		}
	}
	if ([IO.Directory]::Exists($settingsDir)) { [IO.Directory]::Delete($settingsDir, $true) }
	$receipts += "settings dir exists=$([IO.Directory]::Exists($settingsDir))"
	$receipts | ForEach-Object { [Console]::Out.WriteLine($_) }
	return $receipts
}
