param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ArtifactDirectory,

  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-z0-9-]+$")]
  [string]$Invocation,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string[]]$TestArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$telemetryErrors = [System.Collections.Generic.List[object]]::new()

function Add-TelemetryError {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Stage,

    [Parameter(Mandatory = $true)]
    [System.Exception]$Exception
  )

  $telemetryErrors.Add([ordered]@{
      stage = $Stage
      errorType = $Exception.GetType().FullName
    })
  Write-Warning "Windows CI telemetry capture failed during $Stage; test execution continues."
}

function ConvertTo-ProcessRecord {
  param(
    [Parameter(Mandatory = $true)]
    [Microsoft.Management.Infrastructure.CimInstance]$Process
  )

  $creationTimeUtc = if ($null -eq $Process.CreationDate) {
    $null
  } else {
    $Process.CreationDate.ToUniversalTime().ToString("o")
  }

  return [ordered]@{
    name = [string]$Process.Name
    pid = [uint32]$Process.ProcessId
    parentPid = [uint32]$Process.ParentProcessId
    creationTimeUtc = $creationTimeUtc
  }
}

function Get-ProcessRecord {
  param(
    [Parameter(Mandatory = $true)]
    [uint32]$ProcessId
  )

  $process = Get-CimInstance `
    -ClassName Win32_Process `
    -Filter "ProcessId = $ProcessId" `
    -OperationTimeoutSec 5
  if ($null -eq $process) {
    return $null
  }
  return ConvertTo-ProcessRecord -Process $process
}

function Get-SurvivingDescendants {
  param(
    [Parameter(Mandatory = $true)]
    [uint32]$RootProcessId
  )

  $processes = @(Get-CimInstance -ClassName Win32_Process -OperationTimeoutSec 5)
  $descendantIds = [System.Collections.Generic.HashSet[uint32]]::new()
  $pendingParents = [System.Collections.Generic.Queue[uint32]]::new()
  $pendingParents.Enqueue($RootProcessId)

  while ($pendingParents.Count -gt 0) {
    $parentProcessId = $pendingParents.Dequeue()
    foreach ($process in $processes) {
      if ([uint32]$process.ParentProcessId -ne $parentProcessId) {
        continue
      }
      $processId = [uint32]$process.ProcessId
      if ($descendantIds.Add($processId)) {
        $pendingParents.Enqueue($processId)
      }
    }
  }

  return @(
    $processes |
      Where-Object { $descendantIds.Contains([uint32]$_.ProcessId) } |
      ForEach-Object { ConvertTo-ProcessRecord -Process $_ }
  )
}

$preTestUtc = [DateTime]::UtcNow.ToString("o")
$preTestStopwatchTimestamp = [System.Diagnostics.Stopwatch]::GetTimestamp()
$telemetryProcess = $null
try {
  $telemetryProcess = Get-ProcessRecord -ProcessId ([uint32]$PID)
} catch {
  Add-TelemetryError -Stage "pre-test process capture" -Exception $_.Exception
}

$testExitCode = 1
$testProcess = $null
$testProcessRecord = $null
$testLaunchErrorType = $null
try {
  $testProcess = Start-Process `
    -FilePath "bun" `
    -ArgumentList $TestArguments `
    -NoNewWindow `
    -PassThru
  try {
    $testProcessRecord = Get-ProcessRecord -ProcessId ([uint32]$testProcess.Id)
  } catch {
    Add-TelemetryError -Stage "test process capture" -Exception $_.Exception
  }
  $testProcess.WaitForExit()
  $testExitCode = $testProcess.ExitCode
} catch {
  $testLaunchErrorType = $_.Exception.GetType().FullName
  Write-Error "Windows root-test process failed to start or wait." -ErrorAction Continue
}

$postTestUtc = [DateTime]::UtcNow.ToString("o")
$postTestStopwatchTimestamp = [System.Diagnostics.Stopwatch]::GetTimestamp()
$survivingDescendants = @()
if ($null -ne $testProcess) {
  try {
    $survivingDescendants = @(Get-SurvivingDescendants -RootProcessId ([uint32]$testProcess.Id))
  } catch {
    Add-TelemetryError -Stage "post-test descendant capture" -Exception $_.Exception
  }
}

$payload = [ordered]@{
  schemaVersion = 1
  correlation = [ordered]@{
    runId = $env:GITHUB_RUN_ID
    runAttempt = $env:GITHUB_RUN_ATTEMPT
    job = $env:GITHUB_JOB
    shard = $env:WINDOWS_TEST_SHARD
    invocation = $Invocation
  }
  timing = [ordered]@{
    stopwatchFrequency = [string][System.Diagnostics.Stopwatch]::Frequency
    preTest = [ordered]@{
      utc = $preTestUtc
      stopwatchTimestamp = [string]$preTestStopwatchTimestamp
    }
    postTest = [ordered]@{
      utc = $postTestUtc
      stopwatchTimestamp = [string]$postTestStopwatchTimestamp
    }
  }
  temporaryPaths = [ordered]@{
    runnerTemp = $env:RUNNER_TEMP
    processTemp = [System.IO.Path]::GetTempPath()
    temp = $env:TEMP
    tmp = $env:TMP
  }
  telemetryProcess = $telemetryProcess
  testProcess = $testProcessRecord
  testExitCode = $testExitCode
  testLaunchErrorType = $testLaunchErrorType
  survivingDescendants = $survivingDescendants
  telemetryErrors = @($telemetryErrors)
}

try {
  New-Item -ItemType Directory -Path $ArtifactDirectory -Force | Out-Null
  $artifactPath = Join-Path $ArtifactDirectory "$Invocation.json"
  $payload | ConvertTo-Json -Depth 8 | Set-Content -Path $artifactPath -Encoding utf8NoBOM
} catch {
  Add-TelemetryError -Stage "artifact write" -Exception $_.Exception
}

exit $testExitCode
