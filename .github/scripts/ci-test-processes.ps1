param(
  [int]$IntervalMs = 2000,
  [int]$OwnerPid = 0
)
$ErrorActionPreference = "Stop"
# One long-lived sampler per invocation: PowerShell starts once and prints one compressed JSON
# array per sample, so the measured shard does not pay a cold pwsh start every interval.
# It exits on its own when the owning collector is gone, so a crashed collector leaves no sampler.
# Never capture command lines, executable paths, environment, or machine identity.
$properties = @("ProcessId", "ParentProcessId", "CreationDate", "Name", "KernelModeTime", "UserModeTime", "WorkingSetSize")
while ($OwnerPid -le 0 -or $null -ne (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) {
  @(
    Get-CimInstance -ClassName Win32_Process -Property $properties -OperationTimeoutSec 5 |
      ForEach-Object {
        [ordered]@{
          pid = [int]$_.ProcessId
          parentPid = [int]$_.ParentProcessId
          creationTimeUtc = if ($null -eq $_.CreationDate) { $null } else { $_.CreationDate.ToUniversalTime().ToString("o") }
          name = $_.Name
          cpuTimeMs = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000
          rssBytes = [double]$_.WorkingSetSize
        }
      }
  ) | ConvertTo-Json -Depth 3 -Compress -AsArray
  Start-Sleep -Milliseconds $IntervalMs
}
