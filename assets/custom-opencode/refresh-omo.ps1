param(
  [string]$TargetDir = "C:\Users\RedFox\.config\opencode",
  [string]$AssetRoot = $PSScriptRoot,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$script:RefreshLogPath = $null

function Write-RefreshLog {
  param([string]$Message)

  if ($script:RefreshLogPath) {
    Add-Content -LiteralPath $script:RefreshLogPath -Value $Message -Encoding utf8
  }
}

function Write-Step {
  param([string]$Message)

  Write-Host "==> $Message" -ForegroundColor Cyan
  Write-RefreshLog "==> $Message"
}

function Write-Note {
  param([string]$Message)

  Write-Host $Message
  Write-RefreshLog $Message
}

function Resolve-AbsolutePath {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    throw "Path value cannot be empty."
  }

  return [System.IO.Path]::GetFullPath($PathValue)
}

function Ensure-Directory {
  param([string]$DirectoryPath)

  if (-not (Test-Path -LiteralPath $DirectoryPath)) {
    New-Item -ItemType Directory -Path $DirectoryPath -Force | Out-Null
    return $true
  }

  return $false
}

function Get-PortableRelativePath {
  param(
    [string]$BasePath,
    [string]$PathValue
  )

  $normalizedBasePath = (Resolve-AbsolutePath $BasePath).TrimEnd("\", "/")
  $normalizedPathValue = (Resolve-AbsolutePath $PathValue).TrimEnd("\", "/")

  if ($normalizedBasePath -ieq $normalizedPathValue) {
    return "."
  }

  $baseParts = $normalizedBasePath -split '[\\/]'
  $pathParts = $normalizedPathValue -split '[\\/]'
  $maxCommonLength = [Math]::Min($baseParts.Length, $pathParts.Length)
  $commonLength = 0

  while ($commonLength -lt $maxCommonLength -and $baseParts[$commonLength].Equals($pathParts[$commonLength], [System.StringComparison]::OrdinalIgnoreCase)) {
    $commonLength += 1
  }

  if ($commonLength -eq 0 -and $baseParts[0] -match '^[A-Za-z]:$' -and $pathParts[0] -match '^[A-Za-z]:$') {
    return $normalizedPathValue.Replace("\", "/")
  }

  $relativeParts = [System.Collections.Generic.List[string]]::new()

  for ($index = $commonLength; $index -lt $baseParts.Length; $index += 1) {
    $relativeParts.Add("..") | Out-Null
  }

  for ($index = $commonLength; $index -lt $pathParts.Length; $index += 1) {
    $relativeParts.Add($pathParts[$index]) | Out-Null
  }

  if ($relativeParts.Count -eq 0) {
    return "."
  }

  return ($relativeParts -join "/")
}

function Require-Path {
  param(
    [string]$PathValue,
    [string]$Description
  )

  if (-not (Test-Path -LiteralPath $PathValue)) {
    throw "$Description was not found: $PathValue"
  }
}

function Resolve-CommandPath {
  param(
    [string]$Name,
    [string[]]$FallbackPaths = @()
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($fallbackPath in $FallbackPaths) {
    if ($fallbackPath -and (Test-Path -LiteralPath $fallbackPath)) {
      return $fallbackPath
    }
  }

  throw "Required command '$Name' was not found in PATH or fallback paths."
}

function Resolve-DoctorCommand {
  param(
    [string]$TargetDir,
    [string]$NodeCommand
  )

  $shimFallbacks = @(
    (Join-Path $TargetDir "node_modules\.bin\oh-my-opencode.cmd"),
    (Join-Path $TargetDir "node_modules\.bin\oh-my-opencode.ps1"),
    (Join-Path $TargetDir "node_modules\.bin\oh-my-opencode")
  )
  $binScriptFallbacks = @(
    (Join-Path $TargetDir "node_modules\oh-my-openagent\bin\oh-my-opencode.js"),
    (Join-Path $TargetDir "node_modules\oh-my-opencode\bin\oh-my-opencode.js")
  )

  foreach ($fallbackPath in $shimFallbacks) {
    if ($fallbackPath -and (Test-Path -LiteralPath $fallbackPath)) {
      return [ordered]@{
        Executable = $fallbackPath
        Arguments = @()
        Resolution = "target-local-shim"
        ResolvedPath = $fallbackPath
      }
    }
  }

  foreach ($fallbackPath in $binScriptFallbacks) {
    if ($fallbackPath -and (Test-Path -LiteralPath $fallbackPath)) {
      return [ordered]@{
        Executable = $NodeCommand
        Arguments = @($fallbackPath)
        Resolution = "target-package-bin"
        ResolvedPath = $fallbackPath
      }
    }
  }

  $command = Get-Command "oh-my-opencode" -ErrorAction SilentlyContinue
  if ($command) {
    return [ordered]@{
      Executable = $command.Source
      Arguments = @()
      Resolution = "global-path"
      ResolvedPath = $command.Source
    }
  }

  throw "Required command 'oh-my-opencode' was not found in PATH, local shims, or package bin fallbacks."
}

function Get-RefreshAdvisoryDoctorIssueTitles {
  return @(
    "oh-my-openagent is not registered",
    "GitHub CLI missing",
    "Comment checker unavailable"
  )
}

function Get-DoctorIssueTitles {
  param([object]$DoctorResult)

  $issueTitles = [System.Collections.Generic.List[string]]::new()

  foreach ($result in @($DoctorResult.results)) {
    foreach ($issue in @($result.issues)) {
      if ($issue.title -and -not [string]::IsNullOrWhiteSpace([string]$issue.title)) {
        $issueTitles.Add([string]$issue.title) | Out-Null
      }
    }
  }

  return @($issueTitles | Select-Object -Unique)
}

function Get-WindowsPlatformBinaryPackageCandidates {
  return @(
    "oh-my-opencode-windows-x64",
    "oh-my-opencode-windows-x64-baseline"
  )
}

function Ensure-DoctorPlatformBinary {
  param(
    [string]$TargetDir,
    [string]$NpmCommand
  )

  $candidatePackages = Get-WindowsPlatformBinaryPackageCandidates
  foreach ($candidatePackage in $candidatePackages) {
    if (Test-Path -LiteralPath (Join-Path $TargetDir (Join-Path "node_modules" $candidatePackage))) {
      return
    }
  }

  $installedPackagePath = Join-Path $TargetDir "node_modules\oh-my-openagent\package.json"
  if (-not (Test-Path -LiteralPath $installedPackagePath)) {
    Write-Note "Skipping platform binary repair because the managed package manifest was not found under node_modules."
    return
  }

  $installedPackage = Get-Content -LiteralPath $installedPackagePath -Raw | ConvertFrom-Json
  $packageVersion = $installedPackage.version
  if ([string]::IsNullOrWhiteSpace($packageVersion)) {
    Write-Note "Skipping platform binary repair because the managed package version could not be resolved."
    return
  }

  foreach ($candidatePackage in $candidatePackages) {
    $candidateSpec = "$candidatePackage@$packageVersion"

    try {
      Invoke-LoggedCommand -Executable $NpmCommand -Arguments @("install", $candidateSpec, "--no-save") -Description "Installing platform binary package $candidateSpec" -WorkingDirectory $TargetDir | Out-Null
      return
    }
    catch {
      Write-Note "Platform binary install attempt failed for ${candidateSpec}: $($_.Exception.Message)"
    }
  }

  throw "Unable to install a local platform binary package for oh-my-opencode. Tried: $($candidatePackages -join ', ')"
}

function New-RunId {
  param([string]$Timestamp)

  return ($Timestamp -replace '[:.]', '-')
}

function Test-FileContentsMatch {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  if (-not (Test-Path -LiteralPath $DestinationPath)) {
    return $false
  }

  $sourceBytes = [System.IO.File]::ReadAllBytes($SourcePath)
  $destinationBytes = [System.IO.File]::ReadAllBytes($DestinationPath)

  if ($sourceBytes.Length -ne $destinationBytes.Length) {
    return $false
  }

  for ($index = 0; $index -lt $sourceBytes.Length; $index += 1) {
    if ($sourceBytes[$index] -ne $destinationBytes[$index]) {
      return $false
    }
  }

  return $true
}

function Copy-DirectoryEntries {
  param(
    [string]$SourceDir,
    [string]$DestinationDir,
    [string[]]$ExcludeNames = @()
  )

  Ensure-Directory $DestinationDir | Out-Null

  foreach ($entry in Get-ChildItem -LiteralPath $SourceDir -Force) {
    if ($ExcludeNames -contains $entry.Name) {
      continue
    }

    $destinationPath = Join-Path $DestinationDir $entry.Name
    Copy-Item -LiteralPath $entry.FullName -Destination $destinationPath -Recurse -Force
  }
}

function Clear-DirectoryEntries {
  param(
    [string]$DirectoryPath,
    [string[]]$ExcludeNames = @()
  )

  foreach ($entry in Get-ChildItem -LiteralPath $DirectoryPath -Force) {
    if ($ExcludeNames -contains $entry.Name) {
      continue
    }

    Remove-Item -LiteralPath $entry.FullName -Recurse -Force
  }
}

function Backup-TargetState {
  param(
    [string]$SourceDir,
    [string]$BackupDir
  )

  Ensure-Directory $BackupDir | Out-Null
  Copy-DirectoryEntries -SourceDir $SourceDir -DestinationDir $BackupDir -ExcludeNames @("node_modules", ".oh-my-openagent-refresh")
}

function Restore-TargetState {
  param(
    [string]$TargetDir,
    [string]$BackupDir
  )

  if (-not (Test-Path -LiteralPath $BackupDir)) {
    throw "Backup directory was not found: $BackupDir"
  }

  Clear-DirectoryEntries -DirectoryPath $TargetDir -ExcludeNames @("node_modules", ".oh-my-openagent-refresh")
  Copy-DirectoryEntries -SourceDir $BackupDir -DestinationDir $TargetDir
}

function Get-ManagedAssetFiles {
  param([string]$SourceRoot)

  $managedFiles = [System.Collections.Generic.List[System.IO.FileInfo]]::new()

  foreach ($relativePath in @("opencode.json", "oh-my-opencode.json", "refresh-omo.ps1")) {
    $fullPath = Join-Path $SourceRoot $relativePath
    Require-Path $fullPath "Managed asset"
    $managedFiles.Add((Get-Item -LiteralPath $fullPath))
  }

  $pluginsDir = Join-Path $SourceRoot "plugins"
  Require-Path $pluginsDir "Managed plugin directory"

  foreach ($pluginFile in Get-ChildItem -LiteralPath $pluginsDir -Recurse -File | Sort-Object FullName) {
    $managedFiles.Add($pluginFile)
  }

  return $managedFiles | Sort-Object { Get-PortableRelativePath -BasePath $SourceRoot -PathValue $_.FullName }
}

function Invoke-LoggedCommand {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [string]$Description,
    [string]$WorkingDirectory,
    [hashtable]$EnvironmentOverrides = @{},
    [switch]$AllowNonZeroExit
  )

  Write-Step $Description
  Write-RefreshLog ("$Executable " + ($Arguments -join " "))

  $originalDirectory = Get-Location
  $captured = @()
  $previousEnv = @{}
  $previousErrorActionPreference = $ErrorActionPreference

  try {
    if ($WorkingDirectory) {
      Set-Location -LiteralPath $WorkingDirectory
    }

    foreach ($entry in $EnvironmentOverrides.GetEnumerator()) {
      $previousEnv[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key)
      [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value)
    }

    $ErrorActionPreference = "Continue"

    try {
      $captured = & $Executable @Arguments 2>&1
      $exitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    foreach ($line in $captured) {
      Write-Host $line
      Write-RefreshLog ([string]$line)
    }

    if ($AllowNonZeroExit) {
      return [ordered]@{
        Output = ($captured | Out-String)
        ExitCode = $exitCode
      }
    }

    if ($exitCode -ne 0) {
      throw "$Description failed with exit code $exitCode."
    }

    return ($captured | Out-String)
  }
  finally {
    foreach ($entry in $previousEnv.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value)
    }

    $ErrorActionPreference = $previousErrorActionPreference

    Set-Location $originalDirectory
  }
}

function Invoke-DoctorValidation {
  param(
    [hashtable]$DoctorCommand,
    [string]$TargetDir
  )

  $validationEnv = @{ OPENCODE_CONFIG_DIR = $TargetDir }
  $doctorArguments = @($DoctorCommand.Arguments + @("doctor", "--json"))
  $doctorResult = Invoke-LoggedCommand -Executable $DoctorCommand.Executable -Arguments $doctorArguments -Description "Running oh-my-opencode doctor against the synced config" -WorkingDirectory $TargetDir -EnvironmentOverrides $validationEnv -AllowNonZeroExit

  try {
    $doctorPayload = $doctorResult.Output | ConvertFrom-Json
  }
  catch {
    throw "Doctor output could not be parsed as JSON. Resolution: $($DoctorCommand.Resolution)."
  }

  $issueTitles = @(Get-DoctorIssueTitles -DoctorResult $doctorPayload)
  if ($doctorResult.ExitCode -eq 0) {
    return [ordered]@{
      AdvisoryOnly = $false
      IssueTitles = $issueTitles
      ExitCode = $doctorResult.ExitCode
    }
  }

  if ($issueTitles.Count -eq 0) {
    throw "Doctor failed with exit code $($doctorResult.ExitCode) but returned no parseable issues."
  }

  $advisoryIssueTitles = @(Get-RefreshAdvisoryDoctorIssueTitles)
  $nonAdvisoryIssues = @($issueTitles | Where-Object { $advisoryIssueTitles -notcontains $_ })
  if ($nonAdvisoryIssues.Count -gt 0) {
    throw "Doctor reported fatal issue(s): $($nonAdvisoryIssues -join ', ')"
  }

  $advisorySummary = $issueTitles -join ", "
  Write-Note "Doctor reported advisory issues only; continuing refresh: $advisorySummary"
  Write-RefreshLog "Doctor exit code $($doctorResult.ExitCode) accepted because only advisory issues were present: $advisorySummary"

  return [ordered]@{
    AdvisoryOnly = $true
    IssueTitles = $issueTitles
    ExitCode = $doctorResult.ExitCode
  }
}

function Invoke-PowerShellManagedAssetSync {
  param(
    [string]$SourceRoot,
    [string]$TargetRoot,
    [string]$Timestamp,
    [string]$RunId
  )

  $stateDir = Join-Path $TargetRoot ".oh-my-openagent-sync"
  $backupDir = Join-Path $stateDir (Join-Path "backups" $RunId)
  $manifestPath = Join-Path $stateDir "manifest.json"
  $logPath = Join-Path $stateDir "sync.log"
  $createdDirectories = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $fileRecords = [System.Collections.Generic.List[object]]::new()

  foreach ($directoryPath in @($TargetRoot, $stateDir, $backupDir)) {
    if (Ensure-Directory $directoryPath) {
      [void]$createdDirectories.Add((Get-PortableRelativePath -BasePath $TargetRoot -PathValue $directoryPath))
    }
  }

  foreach ($sourceFile in Get-ManagedAssetFiles -SourceRoot $SourceRoot) {
    $relativePath = Get-PortableRelativePath -BasePath $SourceRoot -PathValue $sourceFile.FullName
    $destinationPath = Join-Path $TargetRoot ($relativePath -replace '/', '\\')
    $destinationDir = Split-Path -Parent $destinationPath

    if (Ensure-Directory $destinationDir) {
      [void]$createdDirectories.Add((Get-PortableRelativePath -BasePath $TargetRoot -PathValue $destinationDir))
    }

    $status = "created"
    $backupPath = $null

    if (Test-Path -LiteralPath $destinationPath) {
      $destinationItem = Get-Item -LiteralPath $destinationPath
      if ($destinationItem.PSIsContainer) {
        throw "Cannot sync file onto non-file path: $destinationPath"
      }

      if (Test-FileContentsMatch -SourcePath $sourceFile.FullName -DestinationPath $destinationPath) {
        $status = "unchanged"
      }
      else {
        $backupPath = Join-Path $backupDir ($relativePath -replace '/', '\\')
        $backupParentDir = Split-Path -Parent $backupPath
        if (Ensure-Directory $backupParentDir) {
          [void]$createdDirectories.Add((Get-PortableRelativePath -BasePath $TargetRoot -PathValue $backupParentDir))
        }

        Copy-Item -LiteralPath $destinationPath -Destination $backupPath -Force
        $status = "updated"
      }
    }

    if ($status -ne "unchanged") {
      Copy-Item -LiteralPath $sourceFile.FullName -Destination $destinationPath -Force
    }

    $fileRecords.Add([ordered]@{
      relativePath = $relativePath
      sourcePath = $sourceFile.FullName
      destinationPath = $destinationPath
      status = $status
      backupPath = $backupPath
      bytes = $sourceFile.Length
    }) | Out-Null
  }

  $createdCount = @($fileRecords | Where-Object { $_.status -eq "created" }).Count
  $updatedCount = @($fileRecords | Where-Object { $_.status -eq "updated" }).Count
  $unchangedCount = @($fileRecords | Where-Object { $_.status -eq "unchanged" }).Count
  $backupCount = @($fileRecords | Where-Object { $null -ne $_.backupPath }).Count
  $createdDirectoriesList = @($createdDirectories | Sort-Object)

  $manifest = [ordered]@{
    timestamp = $Timestamp
    runId = $RunId
    assetRoot = $SourceRoot
    targetDir = $TargetRoot
    stateDir = $stateDir
    backupDir = $backupDir
    manifestPath = $manifestPath
    logPath = $logPath
    createdDirectories = $createdDirectoriesList
    files = @($fileRecords)
    summary = [ordered]@{
      created = $createdCount
      updated = $updatedCount
      unchanged = $unchangedCount
      backups = $backupCount
    }
  }

  $logLines = [System.Collections.Generic.List[string]]::new()
  $logLines.Add("Managed custom OpenCode asset sync") | Out-Null
  $logLines.Add("Timestamp: $Timestamp") | Out-Null
  $logLines.Add("Target: $TargetRoot") | Out-Null
  $logLines.Add("Asset root: $SourceRoot") | Out-Null
  $logLines.Add("Backup dir: $backupDir") | Out-Null
  $logLines.Add(("Created directories: " + ($(if (@($createdDirectoriesList).Count -gt 0) { @($createdDirectoriesList) -join ", " } else { "(none)" })))) | Out-Null
  $logLines.Add("") | Out-Null

  foreach ($fileRecord in $fileRecords) {
    $backupSuffix = if ($null -ne $fileRecord.backupPath) { " | backup: $($fileRecord.backupPath)" } else { "" }
    $logLines.Add("[$(($fileRecord.status).ToUpperInvariant())] $($fileRecord.relativePath) -> $($fileRecord.destinationPath)$backupSuffix") | Out-Null
  }

  $manifestJson = $manifest | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $manifestPath -Value ($manifestJson + [Environment]::NewLine) -Encoding utf8
  Set-Content -LiteralPath $logPath -Value (($logLines -join [Environment]::NewLine) + [Environment]::NewLine) -Encoding utf8

  return [ordered]@{
    manifestPath = $manifestPath
    logPath = $logPath
    backupDir = $backupDir
    summary = $manifest.summary
    strategy = "powershell"
  }
}

function Invoke-ManagedAssetSync {
  param(
    [string]$SourceRoot,
    [string]$TargetRoot,
    [string]$Timestamp,
    [string]$RunId,
    [string]$BunCommand
  )

  $repoRoot = Resolve-AbsolutePath (Join-Path $SourceRoot "..\..")
  $repoScriptPath = Join-Path $repoRoot "script\sync-custom-opencode-assets.ts"
  $repoAssetRoot = Join-Path $repoRoot "assets\custom-opencode"
  $canUseBunSync = $false

  if ($BunCommand -and (Test-Path -LiteralPath $repoScriptPath) -and (Test-Path -LiteralPath $repoAssetRoot)) {
    $normalizedRepoAssetRoot = Resolve-AbsolutePath $repoAssetRoot
    $canUseBunSync = ($normalizedRepoAssetRoot -eq $SourceRoot)
  }

  if ($canUseBunSync) {
    $syncOutput = Invoke-LoggedCommand -Executable $BunCommand -Arguments @("run", $repoScriptPath, "--target", $TargetRoot) -Description "Syncing managed OpenCode assets with the repo Bun script" -WorkingDirectory $repoRoot
    return [ordered]@{
      manifestPath = Join-Path $TargetRoot ".oh-my-openagent-sync\manifest.json"
      logPath = Join-Path $TargetRoot ".oh-my-openagent-sync\sync.log"
      backupDir = Join-Path $TargetRoot (Join-Path ".oh-my-openagent-sync\backups" $RunId)
      rawOutput = $syncOutput
      strategy = "bun"
    }
  }

  if (-not $BunCommand) {
    Write-Note "Bun was not found. Using the PowerShell sync fallback that preserves the same .oh-my-openagent-sync manifest and backup layout."
  }
  else {
    Write-Note "A repo-local Bun sync entry point was not available for this AssetRoot. Using the PowerShell sync fallback with the same on-disk contract."
  }

  return Invoke-PowerShellManagedAssetSync -SourceRoot $SourceRoot -TargetRoot $TargetRoot -Timestamp $Timestamp -RunId $RunId
}

$TargetDir = Resolve-AbsolutePath $TargetDir
$AssetRoot = Resolve-AbsolutePath $AssetRoot
Ensure-Directory $TargetDir | Out-Null

$timestamp = [DateTimeOffset]::UtcNow.ToString("o")
$runId = New-RunId -Timestamp $timestamp
$refreshStateDir = Join-Path $TargetDir ".oh-my-openagent-refresh"
$refreshBackupDir = Join-Path $refreshStateDir (Join-Path "backups" $runId)
$refreshLogDir = Join-Path $refreshStateDir "logs"
Ensure-Directory $refreshStateDir | Out-Null
Ensure-Directory $refreshLogDir | Out-Null
$script:RefreshLogPath = Join-Path $refreshLogDir "$runId.log"

Set-Content -LiteralPath $script:RefreshLogPath -Value @(
  "Managed custom OpenCode refresh"
  "Timestamp: $timestamp"
  "Target: $TargetDir"
  "Asset root: $AssetRoot"
  "Mode: $(if ($CheckOnly) { 'check-only' } else { 'update-and-check' })"
  ""
) -Encoding utf8

$packageJsonPath = Join-Path $TargetDir "package.json"
$opencodeCommand = $null
$npmCommand = $null
$nodeCommand = $null
$doctorCommand = $null
$bunCommand = $null
$syncResult = $null
$restoreAttempted = $false

try {
  Write-Step "Checking prerequisites"

  Require-Path $packageJsonPath "Managed config package.json"
  Require-Path (Join-Path $AssetRoot "opencode.json") "Managed host config"
  Require-Path (Join-Path $AssetRoot "oh-my-opencode.json") "Managed plugin config"
  Require-Path (Join-Path $AssetRoot "plugins") "Managed plugin directory"
  Require-Path (Join-Path $AssetRoot "refresh-omo.ps1") "Managed refresh script"

  $nodeCommand = Resolve-CommandPath -Name "node"
  $npmCommand = Resolve-CommandPath -Name "npm"
  $opencodeCommand = Resolve-CommandPath -Name "opencode"

  $bunLookup = Get-Command bun -ErrorAction SilentlyContinue
  if ($bunLookup) {
    $bunCommand = $bunLookup.Source
  }

  $nodeVersion = (& $nodeCommand --version).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to read Node version."
  }

  $nodeMajor = [int](($nodeVersion -replace '^[vV]', '').Split('.')[0])
  if ($nodeMajor -lt 20) {
    Write-Warning "Node $nodeVersion is installed. Node 20+ is recommended for smoother oh-my-openagent updates."
    Write-RefreshLog "Warning: Node $nodeVersion is installed. Node 20+ is recommended for smoother oh-my-openagent updates."
  }

  if ($env:NODE_TLS_REJECT_UNAUTHORIZED -eq "0") {
    Write-Warning "NODE_TLS_REJECT_UNAUTHORIZED=0 is set in the environment. HTTPS certificate verification is disabled."
    Write-RefreshLog "Warning: NODE_TLS_REJECT_UNAUTHORIZED=0 is set in the environment. HTTPS certificate verification is disabled."
  }

  Write-Step "Backing up the current managed config surface"
  Backup-TargetState -SourceDir $TargetDir -BackupDir $refreshBackupDir
  Write-Note "Refresh backup: $refreshBackupDir"

  if (-not $CheckOnly) {
    $npmArguments = if (Test-Path -LiteralPath (Join-Path $TargetDir "node_modules")) {
      @("update", "oh-my-openagent", "@code-yeongyu/comment-checker")
    }
    else {
      @("install")
    }

    Invoke-LoggedCommand -Executable $npmCommand -Arguments $npmArguments -Description "Refreshing oh-my-openagent dependencies in the target config directory" -WorkingDirectory $TargetDir | Out-Null
  }
  else {
    Write-Step "Check-only mode, skipping npm refresh"
  }

  $doctorCommand = Resolve-DoctorCommand -TargetDir $TargetDir -NodeCommand $nodeCommand
  Write-Note "Doctor command resolution: $($doctorCommand.Resolution) -> $($doctorCommand.ResolvedPath)"
  Ensure-DoctorPlatformBinary -TargetDir $TargetDir -NpmCommand $npmCommand

  $syncResult = Invoke-ManagedAssetSync -SourceRoot $AssetRoot -TargetRoot $TargetDir -Timestamp $timestamp -RunId $runId -BunCommand $bunCommand
  Write-Note "Sync strategy: $($syncResult.strategy)"
  Write-Note "Sync manifest: $($syncResult.manifestPath)"
  Write-Note "Sync log: $($syncResult.logPath)"
  Write-Note "Sync backup dir: $($syncResult.backupDir)"

  $validationEnv = @{ OPENCODE_CONFIG_DIR = $TargetDir }

  $opencodeVersion = Invoke-LoggedCommand -Executable $opencodeCommand -Arguments @("--version") -Description "Checking OpenCode version" -WorkingDirectory $TargetDir -EnvironmentOverrides $validationEnv
  $debugOutput = Invoke-LoggedCommand -Executable $opencodeCommand -Arguments @("debug", "config") -Description "Inspecting the resolved OpenCode config" -WorkingDirectory $TargetDir -EnvironmentOverrides $validationEnv

  if ($debugOutput -notmatch 'prometheus') {
    throw "Resolved config output does not mention the managed default agent 'prometheus'."
  }

  Invoke-DoctorValidation -DoctorCommand $doctorCommand -TargetDir $TargetDir | Out-Null

  Write-Host "" 
  Write-Host "Refresh complete." -ForegroundColor Green
  Write-RefreshLog "Refresh complete."
  Write-RefreshLog "OpenCode version : $(($opencodeVersion -split [Environment]::NewLine | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim())"
  Write-RefreshLog "Node version     : $nodeVersion"
  Write-RefreshLog "Target dir       : $TargetDir"
  Write-RefreshLog "Asset root       : $AssetRoot"
  Write-RefreshLog "Refresh backup   : $refreshBackupDir"
  Write-RefreshLog "Refresh log      : $script:RefreshLogPath"
  Write-RefreshLog "Sync manifest    : $($syncResult.manifestPath)"
  Write-RefreshLog "Mode             : $(if ($CheckOnly) { 'check-only' } else { 'update-and-check' })"
  Write-Host "OpenCode version : $(($opencodeVersion -split [Environment]::NewLine | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim())"
  Write-Host "Node version     : $nodeVersion"
  Write-Host "Target dir       : $TargetDir"
  Write-Host "Asset root       : $AssetRoot"
  Write-Host "Refresh backup   : $refreshBackupDir"
  Write-Host "Refresh log      : $script:RefreshLogPath"
  Write-Host "Sync manifest    : $($syncResult.manifestPath)"
  Write-Host "Mode             : $(if ($CheckOnly) { 'check-only' } else { 'update-and-check' })"
}
catch {
  $originalErrorMessage = $_.Exception.Message
  $restoreMessage = "No backup directory was available for restore."

  if (Test-Path -LiteralPath $refreshBackupDir) {
    $restoreAttempted = $true

    try {
      Write-Step "Refresh failed, restoring the previous managed config backup"
      Restore-TargetState -TargetDir $TargetDir -BackupDir $refreshBackupDir
      $restoreMessage = "Previous config restored from $refreshBackupDir."

      if ($opencodeCommand) {
        Invoke-LoggedCommand -Executable $opencodeCommand -Arguments @("debug", "config") -Description "Verifying the restored config" -WorkingDirectory $TargetDir -EnvironmentOverrides @{ OPENCODE_CONFIG_DIR = $TargetDir } | Out-Null
      }
    }
    catch {
      $restoreMessage = "Restore attempt from $refreshBackupDir failed: $($_.Exception.Message)"
    }
  }

  Write-RefreshLog "Original error: $originalErrorMessage"
  Write-RefreshLog "Restore status: $restoreMessage"

  throw "Managed refresh failed. $restoreMessage Original error: $originalErrorMessage"
}
