import { spawn } from "node:child_process"

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

const XML_ENTITIES: { readonly [entity: string]: string } = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }

// The text of a CLIXML line's <S> strings: a redirected Windows PowerShell writes its error record as several
// <S S="Error"> elements whose line breaks are escaped as _x000D__x000A_. The progress object holds no <S> text.
const clixmlText = (line: string): string =>
  [...line.matchAll(/<S(?: S="[^"]*")?>([^<]*)<\/S>/g)]
    .map((match) => match[1] ?? "")
    .join("")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, entity: string) => XML_ENTITIES[entity] ?? "")

// PowerShell wraps a long message over several lines and then prints its position ("At line:", "+ ...").
const POSITION_LINE = /^(?:At line:\d|At .*char:\d|\+ )/

const errorMessage = (err: string | undefined): string => {
  const lines = (err ?? "")
    .split(/\r?\n/)
    .filter((text) => !text.trim().startsWith("#< CLIXML"))
    .flatMap((text) => (text.trim().startsWith("<") ? clixmlText(text).split(/\r?\n/) : [text]))
    .map((text) => text.trim())
    .filter((text) => text !== "")
  const end = lines.findIndex((text) => POSITION_LINE.test(text))
  const message = lines.slice(0, end === -1 ? lines.length : end).join(" ")
  return message === "" ? "" : `: ${message.slice(0, 300)}`
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

// The vendored script's SetOwner is refused on the GitHub runner: SeRestorePrivilege is present and
// disabled, and the progress record is the first stderr line. icacls enables the privilege. The DACL
// written afterwards is still the vendored one-ACE descriptor. dacl.ts stays byte-pinned.
// Set-Acl is not used either: its FileSystem provider first writes every section, the SACL among them
// (SeSecurityPrivilege), and its fallback keeps that section whenever the existing DACL is protected.
// SetAccessControl on the item persists only the sections the script changed: the protected DACL.
const OWNER_LINE = "$acl.SetOwner($sid)\n"
const SET_ACL_LINE = "Set-Acl -LiteralPath $env:LA_PATH -AclObject $acl\n"
const SET_DACL_LINE = "(Get-Item -LiteralPath $env:LA_PATH -Force).SetAccessControl($acl)\n"
const RUNNER_PREFIX = String.raw`$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$ownerSet = & icacls.exe $env:LA_PATH /setowner "*$($env:LA_SID)" 2>&1
if ($LASTEXITCODE -ne 0) { throw "setowner failed: $ownerSet" }
`
if (!APPLY_DACL_SCRIPT.includes(OWNER_LINE) || !APPLY_DACL_SCRIPT.includes(SET_ACL_LINE)) {
  throw new Error("the vendored DACL script no longer sets the owner and the ACL on their own lines")
}
const RUNNER_APPLY_SCRIPT = APPLY_DACL_SCRIPT.replace("$ErrorActionPreference = 'Stop'\n", RUNNER_PREFIX)
  .replace(OWNER_LINE, "")
  .replace(SET_ACL_LINE, SET_DACL_LINE)

export const applyExactDacl = async (
  path: string,
  userSid: string,
  kind: "dir" | "file",
  run: PowerShellRunner = runPowerShell,
): Promise<void> => {
  const { code, err } = await run(RUNNER_APPLY_SCRIPT, { LA_PATH: path, LA_SID: userSid, LA_KIND: kind })
  if (code !== 0)
    throw new LocalApiError("insecure_state_dir", `the exact DACL could not be applied${errorMessage(err)}`)
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
