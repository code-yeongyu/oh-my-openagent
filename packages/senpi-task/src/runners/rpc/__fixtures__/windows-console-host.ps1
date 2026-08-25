Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OmoConsoleHost {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AllocConsole();
}
'@

if (-not [OmoConsoleHost]::AllocConsole()) {
  $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($errorCode -ne 5) {
    Set-Content -LiteralPath $env:OMO_PROBE_ERROR_FILE -Value "AllocConsole failed: $errorCode"
    exit 1
  }
}

$bun = $env:OMO_PROBE_BUN
$script = $env:OMO_PROBE_SCRIPT
$mode = $env:OMO_PROBE_MODE
$root = $env:OMO_PROBE_ROOT
if (-not $bun -or -not $script -or -not $mode -or -not $root) {
  [Console]::Error.WriteLine("Missing OMO probe host environment")
  exit 1
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $bun
$startInfo.Arguments = "`"$script`" --parent $mode `"$root`""
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true

try {
  $parent = [System.Diagnostics.Process]::Start($startInfo)
  $parent.WaitForExit()
  if ($parent.ExitCode -ne 0 -and -not (Test-Path -LiteralPath $env:OMO_PROBE_ERROR_FILE)) {
    Set-Content -LiteralPath $env:OMO_PROBE_ERROR_FILE -Value "Probe parent exited $($parent.ExitCode)"
  }
  exit $parent.ExitCode
} catch {
  Set-Content -LiteralPath $env:OMO_PROBE_ERROR_FILE -Value $_.Exception.Message
  exit 1
}
