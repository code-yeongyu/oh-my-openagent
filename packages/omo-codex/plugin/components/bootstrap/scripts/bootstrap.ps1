# allow: SIZE_OK - Windows bootstrap hook keeps PowerShell 5.1-compatible resolver/provisioning flow in one audited entrypoint.
# LazyCodex bootstrap SessionStart hook for native Windows (Windows PowerShell 5.1).
# Codex runs hooks through %COMSPEC%, so node may be absent from PATH entirely.
# Resolve Codex-managed Node first, then the portable ZIP pinned by
# manifests/node.json, then common install dirs and PATH. Never install system
# dependencies or mutate the user PATH from a hook.
# Git Bash is prepared best-effort on the provisioning path, then the script
# delegates to the bundled node hook. It always exits 0: provisioning failures
# are logged to $env:PLUGIN_DATA\bootstrap\ps-bootstrap.log, never block a session.

$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:LogPath = $null
$script:DoctorHint = "npx lazycodex-ai doctor"
$script:NonGitBashLauncherDirSegments = @("\windows\system32\", "\microsoft\windowsapps\")

function Initialize-BootstrapLog {
	if ([string]::IsNullOrWhiteSpace($env:PLUGIN_DATA)) { return }
	try {
		$logDirectory = Join-Path $env:PLUGIN_DATA "bootstrap"
		if (-not (Test-Path -LiteralPath $logDirectory)) {
			New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
		}
		$script:LogPath = Join-Path $logDirectory "ps-bootstrap.log"
	} catch {
		$script:LogPath = $null
	}
}

function Write-BootstrapLog {
	param([string]$Message)
	if ($null -eq $script:LogPath) { return }
	try {
		$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
		Add-Content -LiteralPath $script:LogPath -Value ($stamp + " " + $Message) -Encoding ASCII
	} catch { }
}

function Resolve-CodexHome {
	if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) { return $env:CODEX_HOME.Trim() }
	if (-not [string]::IsNullOrWhiteSpace($env:PLUGIN_ROOT)) {
		$current = $env:PLUGIN_ROOT
		for ($level = 0; $level -lt 6; $level += 1) {
			$parent = Split-Path -Path $current -Parent
			if ([string]::IsNullOrEmpty($parent) -or ($parent -eq $current)) { break }
			$current = $parent
			if (Test-Path -LiteralPath (Join-Path $current "config.toml") -PathType Leaf) { return $current }
		}
	}
	return (Join-Path $env:USERPROFILE ".codex")
}

function Get-NodeManifest {
	$manifestPath = Join-Path $env:PLUGIN_ROOT "components\bootstrap\manifests\node.json"
	if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
		Write-BootstrapLog ("degraded component=node reason=manifest-missing path=" + $manifestPath + " hint=" + $script:DoctorHint)
		return $null
	}
	try {
		return (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
	} catch {
		Write-BootstrapLog ("degraded component=node reason=manifest-unparsable path=" + $manifestPath + " hint=" + $script:DoctorHint)
		return $null
	}
}

function Get-PortableNodeDirectory {
	param([string]$CodexHome, $Manifest)
	$runtimeRoot = Join-Path $CodexHome "runtime\node"
	return (Join-Path $runtimeRoot ("node-v" + $Manifest.version + "-win-x64"))
}

function Resolve-NodeReplNodePath {
	param([string]$CodexHome)
	if (-not [string]::IsNullOrWhiteSpace($env:NODE_REPL_NODE_PATH)) {
		$candidate = $env:NODE_REPL_NODE_PATH.Trim()
		if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
	}
	$configPath = Join-Path $CodexHome "config.toml"
	if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $null }
	try {
		foreach ($line in Get-Content -LiteralPath $configPath) {
			if ($line -match '^\s*NODE_REPL_NODE_PATH\s*=\s*[''"]([^''"]+)[''"]') {
				$candidate = $Matches[1]
				if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
			}
		}
	} catch {
		Write-BootstrapLog ("degraded component=node reason=config-read-failed path=" + $configPath + " error=" + $_.Exception.Message + " hint=" + $script:DoctorHint)
	}
	return $null
}

function Resolve-NodeCommand {
	param([string]$CodexHome, $Manifest)
	$codexNode = Resolve-NodeReplNodePath -CodexHome $CodexHome
	if ($null -ne $codexNode) { return $codexNode }
	$candidateDirectories = @()
	if ($null -ne $Manifest) {
		$candidateDirectories += (Get-PortableNodeDirectory -CodexHome $CodexHome -Manifest $Manifest)
	}
	if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
		$candidateDirectories += (Join-Path $env:ProgramFiles "nodejs")
	}
	if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
		$candidateDirectories += (Join-Path $env:LOCALAPPDATA "Programs\nodejs")
	}
	foreach ($directory in $candidateDirectories) {
		$candidate = Join-Path $directory "node.exe"
		if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
	}
	$onPath = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
	if ($null -ne $onPath) {
		return (@($onPath)[0]).Source
	}
	return $null
}

function Install-PortableNode {
	param([string]$CodexHome, $Manifest)
	if ($null -eq $Manifest) { return $null }
	$platformEntry = $Manifest.platforms."win32-x64"
	if ($null -eq $platformEntry) {
		Write-BootstrapLog ("degraded component=node reason=manifest-missing-win32-x64 hint=" + $script:DoctorHint)
		return $null
	}
	$zipPath = Join-Path $env:TEMP ("lazycodex-node-v" + $Manifest.version + "-win-x64.zip")
	Write-BootstrapLog ("downloading portable node from " + $platformEntry.url)
	try {
		Invoke-WebRequest -Uri $platformEntry.url -OutFile $zipPath -UseBasicParsing
	} catch {
		Write-BootstrapLog ("degraded component=node reason=download-failed url=" + $platformEntry.url + " error=" + $_.Exception.Message + " hint=" + $script:DoctorHint)
		return $null
	}
	$expectedHash = ([string]$platformEntry.sha256).ToLowerInvariant()
	$actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
	if ($actualHash -ne $expectedHash) {
		Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
		Write-BootstrapLog ("degraded component=node reason=sha256-mismatch expected=" + $expectedHash + " actual=" + $actualHash + " hint=" + $script:DoctorHint)
		return $null
	}
	$runtimeRoot = Join-Path $CodexHome "runtime\node"
	try {
		if (-not (Test-Path -LiteralPath $runtimeRoot)) {
			New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
		}
		Expand-Archive -LiteralPath $zipPath -DestinationPath $runtimeRoot -Force
	} catch {
		Write-BootstrapLog ("degraded component=node reason=extract-failed error=" + $_.Exception.Message + " hint=" + $script:DoctorHint)
		return $null
	} finally {
		Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
	}
	$nodeDirectory = Get-PortableNodeDirectory -CodexHome $CodexHome -Manifest $Manifest
	$nodeExe = Join-Path $nodeDirectory "node.exe"
	if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
		Write-BootstrapLog ("degraded component=node reason=extracted-layout-unexpected expected=" + $nodeExe + " hint=" + $script:DoctorHint)
		return $null
	}
	Write-BootstrapLog ("portable node provisioned at " + $nodeExe)
	return $nodeExe
}

function Test-KnownNonGitBashLauncher {
	param([string]$CandidatePath)
	$normalized = $CandidatePath.Replace("/", "\").ToLowerInvariant()
	foreach ($segment in $script:NonGitBashLauncherDirSegments) {
		if ($normalized.Contains($segment)) { return $true }
	}
	return $false
}

function Resolve-GitBash {
	if (-not [string]::IsNullOrWhiteSpace($env:OMO_CODEX_GIT_BASH_PATH)) {
		$envCandidate = $env:OMO_CODEX_GIT_BASH_PATH.Trim()
		if ($envCandidate.ToLowerInvariant().EndsWith("bash.exe") -and (Test-Path -LiteralPath $envCandidate -PathType Leaf)) {
			return @{ Path = $envCandidate; Source = "env" }
		}
		return $null
	}
	$programFilesCandidates = @()
	if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
		$programFilesCandidates += (Join-Path $env:ProgramFiles "Git\bin\bash.exe")
	}
	$programFilesX86 = ${env:ProgramFiles(x86)}
	if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
		$programFilesCandidates += (Join-Path $programFilesX86 "Git\bin\bash.exe")
	}
	foreach ($candidate in $programFilesCandidates) {
		if (Test-Path -LiteralPath $candidate -PathType Leaf) {
			return @{ Path = $candidate; Source = "program-files" }
		}
	}
	$whereOutput = @()
	try { $whereOutput = & where.exe bash 2>$null } catch { $whereOutput = @() }
	foreach ($rawLine in @($whereOutput)) {
		if ($null -eq $rawLine) { continue }
		$candidate = ([string]$rawLine).Trim()
		if ($candidate.Length -eq 0) { continue }
		if (Test-KnownNonGitBashLauncher -CandidatePath $candidate) { continue }
		if ($candidate.ToLowerInvariant().EndsWith("bash.exe") -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
			return @{ Path = $candidate; Source = "path" }
		}
	}
	return $null
}

function Initialize-GitBash {
	$resolution = Resolve-GitBash
	if ($null -eq $resolution) {
		Write-BootstrapLog ("degraded component=git_bash reason=not-found install=Install Git for Windows or set OMO_CODEX_GIT_BASH_PATH hint=" + $script:DoctorHint)
		return
	}
	Write-BootstrapLog ("git bash resolved at " + $resolution.Path + " source=" + $resolution.Source)
	if ($resolution.Source -eq "path") {
		$persisted = [Environment]::GetEnvironmentVariable("OMO_CODEX_GIT_BASH_PATH", "User")
		if ([string]::IsNullOrWhiteSpace($persisted)) {
			[Environment]::SetEnvironmentVariable("OMO_CODEX_GIT_BASH_PATH", $resolution.Path, "User")
			Write-BootstrapLog ("persisted OMO_CODEX_GIT_BASH_PATH=" + $resolution.Path + " in the USER environment; restart Codex to pick it up")
		}
	}
}

function Invoke-NodeHookDelegate {
	param([string]$NodeExe)
	$hookCli = Join-Path $env:PLUGIN_ROOT "components\bootstrap\dist\cli.js"
	if (-not (Test-Path -LiteralPath $hookCli -PathType Leaf)) {
		Write-BootstrapLog ("degraded component=bootstrap reason=hook-cli-missing path=" + $hookCli + " hint=" + $script:DoctorHint)
		return
	}
	Write-BootstrapLog ("delegating to node hook: " + $NodeExe + " " + $hookCli + " hook session-start")
	& $NodeExe $hookCli hook session-start
	Write-BootstrapLog ("node hook exited with code " + $LASTEXITCODE)
}

function Write-ProvisioningIncompleteNotice {
	$notice = "LazyCodex bootstrap: Node.js is not available yet. Rerun LazyCodex install from Codex Desktop or install Node LTS manually, then restart Codex. Diagnose with: " + $script:DoctorHint
	$payload = @{
		hookSpecificOutput = @{
			hookEventName = "SessionStart"
			additionalContext = $notice
		}
	}
	Write-Output (ConvertTo-Json -InputObject $payload -Compress -Depth 4)
}

function Invoke-Bootstrap {
	Initialize-BootstrapLog
	Write-BootstrapLog "bootstrap.ps1 session-start begin"
	if ([string]::IsNullOrWhiteSpace($env:PLUGIN_ROOT)) {
		Write-BootstrapLog "PLUGIN_ROOT missing; skipping bootstrap"
		return
	}
	$codexHome = Resolve-CodexHome
	Write-BootstrapLog ("codex home resolved to " + $codexHome)
	$manifest = Get-NodeManifest
	$nodeExe = Resolve-NodeCommand -CodexHome $codexHome -Manifest $manifest
	if ($null -ne $nodeExe) {
		Write-BootstrapLog ("node already available at " + $nodeExe)
		Invoke-NodeHookDelegate -NodeExe $nodeExe
		return
	}
		$nodeExe = Install-PortableNode -CodexHome $codexHome -Manifest $manifest
	Initialize-GitBash
	if ($null -eq $nodeExe) {
		Write-BootstrapLog ("degraded component=node reason=unresolved hint=" + $script:DoctorHint)
		Write-ProvisioningIncompleteNotice
		return
	}
	Invoke-NodeHookDelegate -NodeExe $nodeExe
}

try {
	Invoke-Bootstrap
} catch {
	try { Write-BootstrapLog ("unhandled bootstrap error: " + $_.Exception.Message) } catch { }
}
exit 0
