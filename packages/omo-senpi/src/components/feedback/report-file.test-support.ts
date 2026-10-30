import { expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { statSync } from "node:fs"
import { isAbsolute, relative } from "node:path"

const WINDOWS_SYSTEM_SID = "S-1-5-18"
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544"

export interface WindowsAclEntry {
  readonly sid: string
  readonly type: "Allow" | "Deny"
}

/**
 * The file's ACL as SIDs, so the check does not depend on localized account names. It reads the ACL through .NET
 * rather than Get-Acl and passes no PSModulePath: a parent PowerShell 7 exports a PSModulePath that Windows PowerShell
 * 5.1 cannot load its own modules from, which breaks every module cmdlet in the child.
 */
export const readWindowsAcl = (path: string): { readonly user: string; readonly entries: readonly WindowsAclEntry[] } => {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "'user=' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$rules = [System.IO.FileInfo]::new($env:OMO_ACL_PATH).GetAccessControl().GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])",
    "foreach ($rule in $rules) { 'rule=' + $rule.IdentityReference.Value + '|' + $rule.AccessControlType }",
  ].join("; ")
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"))
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...env, OMO_ACL_PATH: path },
  })
  if (result.status !== 0) throw new Error(`reading the ACL failed for ${path}: ${result.stderr}`)
  const lines = result.stdout.split(/\r?\n/)
  const user = lines.find((line) => line.startsWith("user="))?.slice("user=".length)
  if (user === undefined || user === "") throw new Error(`no current-user SID in the ACL output for ${path}: ${result.stdout}`)
  const entries = lines.flatMap((line): WindowsAclEntry[] => {
    if (!line.startsWith("rule=")) return []
    const [sid, type] = line.slice("rule=".length).split("|")
    return sid !== undefined && (type === "Allow" || type === "Deny") ? [{ sid, type }] : []
  })
  if (entries.length === 0) throw new Error(`no ACL entries read for ${path}: ${result.stdout}`)
  return { user, entries }
}

export const unexpectedWindowsReaders = (acl: ReturnType<typeof readWindowsAcl>): readonly string[] => {
  const allowed = new Set([acl.user, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID])
  return acl.entries.filter((entry) => entry.type === "Allow" && !allowed.has(entry.sid)).map((entry) => entry.sid)
}

/**
 * A saved report or ledger must be readable by its owner only. Every platform: it lives inside the per-user state root.
 * POSIX: owner-only mode bits. Windows (no mode bits): its ACL grants access only to the current user, SYSTEM and the
 * Administrators group, read as SIDs.
 */
export const expectUserOnly = (path: string, root: string): void => {
  const inside = relative(root, path)
  expect(inside === "" || inside.startsWith("..") || isAbsolute(inside)).toBe(false)
  if (process.platform === "win32") {
    const acl = readWindowsAcl(path)
    expect(acl.entries.some((entry) => entry.type === "Allow" && entry.sid === acl.user)).toBe(true)
    expect(unexpectedWindowsReaders(acl)).toEqual([])
    return
  }
  expect(statSync(path).mode & 0o077).toBe(0)
}
