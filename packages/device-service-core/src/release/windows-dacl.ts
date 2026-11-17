import { spawn } from "node:child_process"

import { LocalApiError } from "../local-api/errors.ts"
import type { SecureFile } from "../local-api/access.ts"
import { type DaclDescription, describeDacl, exactDaclVerdict } from "../local-api/dacl.ts"

// omo's Windows exact-DACL writer for the files it installs (#12023), over the vendored dacl.ts. The vendored verdict
// compares against the literal SID only, but SDDL prints some users by an alias (the built-in Administrator, RID 500,
// as LA, the windows-latest runner user), so a DACL written for that user would never verify. This accepts exactly the
// alias Windows prints for the user SID, and a failed apply names the first line of the script's error.

const SID_TOKEN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
(New-Object System.Security.AccessControl.RawSecurityDescriptor("O:$env:LA_SID")).GetSddlForm('Owner')
`

// The vendored runner's contract plus the script's stderr, which the vendored runPowerShell reads and drops.
export type PowerShellRunner = (
  script: string,
  env: { readonly [name: string]: string },
) => Promise<{ readonly code: number; readonly out: string; readonly err?: string }>

const runPowerShell: PowerShellRunner = async (script, env) => {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  )
  const chunks: Buffer[] = []
  const errChunks: Buffer[] = []
  proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
  proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk))
  const code = await new Promise<number>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (exitCode) => resolve(exitCode ?? -1))
  })
  return { code, out: Buffer.concat(chunks).toString("utf8"), err: Buffer.concat(errChunks).toString("utf8") }
}

const decodePowerShellText = (text: string): string =>
  text.replace(/_x([0-9A-Fa-f]{4})_/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))

const firstErrorLine = (err: string | undefined): string => {
  const decoded = decodePowerShellText(err ?? "")
  const lines = decoded
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter((text) => text !== "" && text !== "Exception" && !text.startsWith("#< CLIXML") && !text.startsWith("<Objs"))
  // A redirected Windows PowerShell writes its progress record as CLIXML on the same stream as the
  // real error. The progress object is not the failure. Encoded newlines (_x000D__x000A_) are decoded first.
  const plain = lines.find((text) => !text.startsWith("<"))
  const tagged = [...decoded.matchAll(/<S[^>]*>([^<]+)<\/S>/g)]
    .map((match) => match[1]?.trim() ?? "")
    .find((text) => text !== "" && text !== "Exception")
  const line = plain ?? tagged ?? ""
  return line === "" ? "" : `: ${line.slice(0, 300)}`
}

// The SDDL token for userSid on this machine (an alias such as "LA", or the SID itself); undefined when it cannot be
// read, so the verdict then accepts the literal SID only.
export const userSidToken = async (
  userSid: string,
  run: PowerShellRunner = runPowerShell,
): Promise<string | undefined> => {
  const { code, out } = await run(SID_TOKEN_SCRIPT, { LA_SID: userSid })
  const match = code === 0 ? /^O:(S-1-\d+(?:-\d+)+|[A-Z]{2})$/.exec(out.trim()) : null
  return match?.[1]
}

// The vendored verdict with `userAlias` read as the user: the alias is mapped to the SID before the exact comparison.
export const aliasedDaclVerdict = (
  dacl: DaclDescription,
  userSid: string,
  kind: "dir" | "file",
  userAlias?: string,
): boolean => {
  const asSid = (token: string): string => (userAlias !== undefined && token === userAlias ? userSid : token)
  return exactDaclVerdict(
    { ...dacl, owner: asSid(dacl.owner), aces: dacl.aces.map((ace) => ({ ...ace, sid: asSid(ace.sid) })) },
    userSid,
    kind,
  )
}

// A fresh FileSecurity passed to Set-Acl is refused ("unauthorized operation") on the GitHub runner,
// with or without SetOwner. icacls sets the owner, then Get-Acl edits that live descriptor down to
// one protected ACE. The vendored dacl.ts stays byte-pinned.
const RUNNER_APPLY_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$ownerOut = & icacls.exe $env:LA_PATH /setowner "*$($env:LA_SID)" 2>&1 | Out-String
$ownerCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($ownerCode -ne 0) { throw "setowner failed: $ownerOut" }
$sid = New-Object System.Security.Principal.SecurityIdentifier($env:LA_SID)
$acl = Get-Acl -LiteralPath $env:LA_PATH
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
if ($env:LA_KIND -eq 'dir') {
  $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
}
$grant = New-Object System.Security.AccessControl.FileSystemAccessRule($sid,
  [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit,
  [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($grant)
Set-Acl -LiteralPath $env:LA_PATH -AclObject $acl
Write-Output 'applied'
`

export const applyExactDacl = async (
  path: string,
  userSid: string,
  kind: "dir" | "file",
  run: PowerShellRunner = runPowerShell,
): Promise<void> => {
  const { code, err } = await run(RUNNER_APPLY_SCRIPT, { LA_PATH: path, LA_SID: userSid, LA_KIND: kind })
  if (code !== 0)
    throw new LocalApiError("insecure_state_dir", `the exact DACL could not be applied${firstErrorLine(err)}`)
}

// Fails closed: a DACL that cannot be read back is not exact.
export const verifyExactDacl = async (
  path: string,
  userSid: string,
  kind: "dir" | "file",
  run: PowerShellRunner = runPowerShell,
): Promise<boolean> => {
  let dacl: DaclDescription
  try {
    dacl = await describeDacl(path, run)
  } catch (error) {
    if (error instanceof LocalApiError) return false
    throw error
  }
  return aliasedDaclVerdict(dacl, userSid, kind, await userSidToken(userSid, run))
}

export const windowsSecureFile =
  (userSid: string, run: PowerShellRunner = runPowerShell): SecureFile =>
  async (path, kind) => {
    const target = kind === "dir" ? "dir" : "file"
    await applyExactDacl(path, userSid, target, run)
    if (!(await verifyExactDacl(path, userSid, target, run)))
      throw new LocalApiError("insecure_state_dir", "the DACL is not exactly one ACE for the user")
  }
