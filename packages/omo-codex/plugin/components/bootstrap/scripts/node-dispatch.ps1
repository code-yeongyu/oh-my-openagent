param(
	[Parameter(Mandatory = $true, Position = 0)]
	[string]$Target,
	[Parameter(ValueFromRemainingArguments = $true, Position = 1)]
	[string[]]$RemainingArgs
)

$ErrorActionPreference = "Continue"

function Resolve-CodexHome {
	if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) { return $env:CODEX_HOME.Trim() }
	return (Join-Path $env:USERPROFILE ".codex")
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
	} catch { }
	return $null
}

function Resolve-PortableNode {
	param([string]$CodexHome)
	$runtimeRoot = Join-Path $CodexHome "runtime\node"
	if (-not (Test-Path -LiteralPath $runtimeRoot)) { return $null }
	try {
		$nodes = @(Get-ChildItem -LiteralPath $runtimeRoot -Recurse -Filter "node.exe" -ErrorAction SilentlyContinue)
		if ($nodes.Count -gt 0) { return $nodes[0].FullName }
	} catch { }
	return $null
}

function Resolve-NodeCommand {
	param([string]$CodexHome)
	$codexNode = Resolve-NodeReplNodePath -CodexHome $CodexHome
	if ($null -ne $codexNode) { return $codexNode }
	$portableNode = Resolve-PortableNode -CodexHome $CodexHome
	if ($null -ne $portableNode) { return $portableNode }
	$candidateDirectories = @()
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
	if ($null -ne $onPath) { return (@($onPath)[0]).Source }
	return $null
}

$codexHome = Resolve-CodexHome
$nodeExe = Resolve-NodeCommand -CodexHome $codexHome
if ($null -eq $nodeExe) {
	Write-Error "LazyCodex hook could not find Node. Rerun LazyCodex install from Codex Desktop or set NODE_REPL_NODE_PATH in Codex config."
	exit 127
}

& $nodeExe $Target @RemainingArgs
exit $LASTEXITCODE
