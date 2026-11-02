import { runPowerShell } from "../../src/local-api/dacl.ts";

// Reads a file as another local user: LogonUser with that user's password, then the read runs impersonated. The
// answer is "read_ok", "read_denied" (UnauthorizedAccessException) or a diagnostic; a logon that fails in every
// logon type answers "logon_failed", so a refused read is never mistaken for a failed logon.
const READ_AS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LaLogon {
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool LogonUser(string user, string domain, string password, int type, int provider, out IntPtr token);
}
'@
$token = [IntPtr]::Zero
$logged = $false
foreach ($type in 3, 2, 8, 4) {
  if ([LaLogon]::LogonUser($env:LA_USER, '.', $env:LA_PASSWORD, $type, 0, [ref]$token)) { $logged = $true; break }
}
if (-not $logged) { Write-Output 'logon_failed'; exit 0 }
$handle = New-Object Microsoft.Win32.SafeHandles.SafeAccessTokenHandle($token)
$answer = [System.Security.Principal.WindowsIdentity]::RunImpersonated($handle, [Func[string]] {
  try { [void][System.IO.File]::ReadAllBytes($env:LA_PATH); 'read_ok' }
  catch [System.UnauthorizedAccessException] { 'read_denied' }
  catch { 'read_error:' + $_.Exception.GetType().Name }
})
Write-Output $answer
`;

export const readAs = async (user: string, password: string, path: string): Promise<string> => {
  const result = await runPowerShell(READ_AS, {
    LA_USER: user,
    LA_PASSWORD: password,
    LA_PATH: path,
  });
  return result.out.trim();
};

export const icacls = async (...args: readonly string[]): Promise<void> => {
  const proc = Bun.spawn(["icacls", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`icacls ${args.join(" ")} exited ${code}: ${out}${err}`);
};

export const EVERYONE = "*S-1-1-0";
