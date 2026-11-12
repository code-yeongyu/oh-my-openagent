import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { delimiter } from "node:path"

import { log } from "@oh-my-opencode/utils"

import { findOnPath } from "../claude-code/find-on-path"

/** How long a lookup answer (a home, a missing account or a failure) is reused before the user database is asked again. */
export const OWNER_LOOKUP_TTL_MS = 30_000

/** The home field of one passwd entry: `getent passwd <uid>` (7 fields) or macOS `id -P <uid>` (10 fields). */
export function homeFromPasswdEntry(entry: string): string | null {
  const fields = entry.split("\n")[0]?.split(":") ?? []
  if (fields.length < 7) return null
  const home = fields[fields.length - 2]
  return home !== undefined && home.startsWith("/") ? home : null
}

export interface PasswdLookupDeps {
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | null
  readonly exec?: (file: string, args: readonly string[]) => string
  /** The text of /etc/nsswitch.conf, null when the file does not exist; throws when it cannot be read. */
  readonly nsswitch?: () => string | null
}

// Checked before PATH, and PATH itself only through its absolute entries: a relative entry resolves against the
// session folder, which could otherwise ship its own getent or id and have it run before the folder is trusted.
const SYSTEM_BIN_DIRS = ["/usr/bin", "/bin", "/usr/sbin"]

function findLookupBinary(command: string): string | null {
  return (
    findOnPath(command, { PATH: SYSTEM_BIN_DIRS.join(delimiter) }) ??
    findOnPath(command, process.env, process.platform, { absoluteOnly: true })
  )
}

function readNsswitch(): string | null {
  try {
    return readFileSync("/etc/nsswitch.conf", "utf8")
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return null
    throw error
  }
}

// NSS modules that read only this host's own files. Any other source (sss, ldap, nis, winbind, compat's NIS lines)
// can be unavailable, and getent reports that the same way as a missing entry.
const LOCAL_PASSWD_SOURCES = new Set(["files", "systemd", "altfiles"])

/** True when passwd entries come from local files alone, so a missing entry proves the account does not exist. */
function passwdComesFromLocalFilesOnly(nsswitch: string | null): boolean {
  if (nsswitch === null) return true
  const line = nsswitch
    .split("\n")
    .map((raw) => raw.replace(/#.*/, "").trim())
    .find((candidate) => /^passwd\s*:/.test(candidate))
  if (line === undefined) return true
  const sources = line
    .slice(line.indexOf(":") + 1)
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .filter((source) => source.length > 0)
  return sources.every((source) => LOCAL_PASSWD_SOURCES.has(source))
}

function execLookup(file: string, args: readonly string[]): string {
  return execFileSync(file, [...args], {
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
}

// getent exits 2 when no source has the key, but it ignores why: a directory service that is down (NSS UNAVAIL) also
// exits 2. So exit 2 means "no such account" only when passwd comes from local files alone. macOS id prints "no such
// user" for an Open Directory failure too, so it never proves a missing account. Anything else is a failed lookup.
function isNoSuchAccount(error: unknown, platform: NodeJS.Platform, nsswitch: () => string | null): boolean {
  if (platform === "darwin" || typeof error !== "object" || error === null) return false
  if (Reflect.get(error, "status") !== 2) return false
  try {
    return passwdComesFromLocalFilesOnly(nsswitch())
  } catch {
    return false
  }
}

/**
 * The passwd entry of the account with this uid through the lookup binary (`getent`, or `id -P` on macOS) from the
 * system bin directories or else an absolute PATH entry, so hosts that keep it outside /usr/bin (NixOS) still answer.
 * Null when there provably is no such account; throws when the binary is missing or the lookup fails.
 */
export function runPasswdLookup(uid: number, deps: PasswdLookupDeps = {}): string | null {
  const platform = deps.platform ?? process.platform
  const [command, args] = platform === "darwin" ? ["id", ["-P", String(uid)]] : ["getent", ["passwd", String(uid)]]
  const file = (deps.which ?? findLookupBinary)(command)
  if (file === null) throw new Error(`${command} is not on PATH`)
  try {
    return (deps.exec ?? execLookup)(file, args)
  } catch (error) {
    if (isNoSuchAccount(error, platform, deps.nsswitch ?? readNsswitch)) return null
    throw error
  }
}

const homeByUid = new Map<number, { readonly home: string | null | undefined; readonly at: number }>()

/**
 * The home of the account with this uid: null when there is no such account, undefined when the lookup failed. Every
 * answer is reused for `OWNER_LOOKUP_TTL_MS`, so a down user database costs at most one call per uid per window, and a
 * recovered database, a moved home or a reused uid is seen again after it.
 */
export function lookupHomeOfUid(
  uid: number,
  run: (uid: number) => string | null = runPasswdLookup,
  now: () => number = Date.now,
): string | null | undefined {
  const cached = homeByUid.get(uid)
  if (cached !== undefined && now() - cached.at < OWNER_LOOKUP_TTL_MS) return cached.home
  let home: string | null | undefined
  try {
    const entry = run(uid)
    home = entry === null ? null : homeFromPasswdEntry(entry)
  } catch (error) {
    log("[model-profile] passwd home lookup failed; the home refusal falls back to its fail-closed rules", {
      uid,
      error: error instanceof Error ? error.message : String(error),
    })
    home = undefined
  }
  homeByUid.set(uid, { home, at: now() })
  return home
}
