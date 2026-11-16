import { LocalApiError } from "../local-api/errors.ts"
import type { SecureFile } from "../local-api/access.ts"
import { APPLY_DACL_SCRIPT, type DaclDescription, describeDacl, exactDaclVerdict } from "../local-api/dacl.ts"

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
  const proc = Bun.spawn(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  )
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out, err }
}

const firstErrorLine = (err: string | undefined): string => {
  const line =
    (err ?? "")
      .split(/\r?\n/)
      .find((text) => text.trim() !== "" && !text.startsWith("#< CLIXML"))
      ?.trim() ?? ""
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

export const applyExactDacl = async (
  path: string,
  userSid: string,
  kind: "dir" | "file",
  run: PowerShellRunner = runPowerShell,
): Promise<void> => {
  const { code, err } = await run(APPLY_DACL_SCRIPT, { LA_PATH: path, LA_SID: userSid, LA_KIND: kind })
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
