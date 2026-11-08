param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
$holders = @{}
$diagnosticErrors = [System.Collections.Generic.List[string]]::new()

try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class HeldRootRestartManager {
  [StructLayout(LayoutKind.Sequential)]
  public struct UniqueProcess {
    public uint pid;
    public FILETIME started;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcessInfo {
    public UniqueProcess process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string appName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string serviceName;
    public uint appType;
    public uint appStatus;
    public uint sessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern uint RmStartSession(out uint session, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern uint RmRegisterResources(uint session, uint count, string[] files,
    uint appCount, IntPtr apps, uint serviceCount, IntPtr services);
  [DllImport("rstrtmgr.dll")]
  public static extern uint RmGetList(uint session, out uint needed, ref uint count,
    [In, Out] ProcessInfo[] processes, ref uint reasons);
  [DllImport("rstrtmgr.dll")]
  public static extern uint RmEndSession(uint session);
}
'@
  [uint32]$session = 0
  $status = [HeldRootRestartManager]::RmStartSession([ref]$session, 0, [System.Text.StringBuilder]::new(33))
  if ($status -ne 0) { throw "RmStartSession returned $status" }
  try {
    # Restart Manager accepts files, not directories. handle.exe below covers directory/cwd handles.
    $files = [string[]]@(Get-ChildItem -LiteralPath $Root -File -Recurse | ForEach-Object { $_.FullName })
    if ($files.Length -gt 0) {
      $status = [HeldRootRestartManager]::RmRegisterResources($session, $files.Length, $files, 0, [IntPtr]::Zero, 0, [IntPtr]::Zero)
      if ($status -ne 0) { throw "RmRegisterResources returned $status" }
      [uint32]$needed = 0
      [uint32]$count = 0
      [uint32]$reasons = 0
      $status = [HeldRootRestartManager]::RmGetList($session, [ref]$needed, [ref]$count, $null, [ref]$reasons)
      if ($status -eq 234) {
        $rows = [HeldRootRestartManager+ProcessInfo[]]::new($needed)
        $count = $needed
        $status = [HeldRootRestartManager]::RmGetList($session, [ref]$needed, [ref]$count, $rows, [ref]$reasons)
        if ($status -ne 0) { throw "RmGetList returned $status" }
        for ($i = 0; $i -lt $count; $i++) {
          $holders[[int]$rows[$i].process.pid] = $rows[$i].appName
        }
      } elseif ($status -ne 0) { throw "RmGetList returned $status" }
    }
  } finally {
    $status = [HeldRootRestartManager]::RmEndSession($session)
    if ($status -ne 0) { $diagnosticErrors.Add("RmEndSession returned $status") }
  }
} catch {
  $diagnosticErrors.Add("Restart Manager: $($_.Exception.Message)")
}

try {
  $handle = Get-Command handle.exe, handle64.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $handle) {
    $diagnosticErrors.Add('handle.exe unavailable; directory-only handles cannot be identified by Restart Manager')
  } else {
    # Do not prompt for or silently accept a license from a diagnostic.
    $accepted = Get-ItemPropertyValue 'HKCU:\Software\Sysinternals\Handle' -Name EulaAccepted -ErrorAction SilentlyContinue
    if ($accepted -ne 1) {
      $diagnosticErrors.Add('handle.exe EULA not accepted; directory handle query not run')
    } else {
      $lines = & $handle.Source -nobanner $Root 2>&1
      foreach ($line in $lines) {
        if ("$line" -match '^(.*?)\s+pid:\s+(\d+)\s') {
          $holders[[int]$Matches[2]] = $Matches[1].Trim()
        }
      }
      if ($LASTEXITCODE -gt 1) { $diagnosticErrors.Add("handle.exe exited $LASTEXITCODE") }
    }
  }
} catch {
  $diagnosticErrors.Add("handle.exe: $($_.Exception.Message)")
}

$rows = @(
  foreach ($holderPid in $holders.Keys) {
    $image = $holders[$holderPid]
    $parentPid = $null
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$holderPid"
      if ($null -eq $process) { throw "process $holderPid exited before parent lookup" }
      $image = $process.Name
      $parentPid = [int]$process.ParentProcessId
    } catch {
      $diagnosticErrors.Add("process ${holderPid}: $($_.Exception.Message)")
    }
    if ([string]::IsNullOrWhiteSpace($image)) { $image = 'unknown' }
    @{ pid = $holderPid; image = $image; parentPid = $parentPid }
  }
)
if ($rows.Count -eq 0) { $diagnosticErrors.Add('No holder identified; the lock may have cleared or be a directory-only handle') }
@{ holders = $rows; diagnosticErrors = @($diagnosticErrors.ToArray()) } | ConvertTo-Json -Depth 4 -Compress
