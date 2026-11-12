import { execFileSync } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path"

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
  /** The text of /etc/passwd, null when the file does not exist; throws when it cannot be read. */
  readonly passwdFile?: () => string | null
  /** Searched before PATH; defaults to `SYSTEM_BIN_DIRS`. */
  readonly systemBinDirs?: readonly string[]
  /** Folders whose binaries must never run (the folder being checked); the current directory always counts. */
  readonly untrustedFolders?: readonly string[]
}

/** Searched before PATH: the usual system directories, then NixOS's system profile and default Nix profile. */
export const SYSTEM_BIN_DIRS: readonly string[] = [
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/run/current-system/sw/bin",
  "/nix/var/nix/profiles/default/bin",
]

const realOrResolved = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function isAtOrBelow(path: string, folder: string): boolean {
  const rest = relative(folder, path)
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest))
}

const isInsideAny = (path: string, folders: readonly string[]): boolean =>
  folders.some((folder) => isAtOrBelow(realOrResolved(path), folder))

// PATH counts only through absolute entries outside every untrusted folder, compared by real path: a relative entry
// resolves against the session folder, and an absolute one can still point into it (direnv `PATH_add bin`,
// `<project>/node_modules/.bin`), so either could run a getent or id the folder ships before the folder is trusted.
// The binary found is held to the same test, because a trusted directory can hold a file symlink into the folder.
function findLookupBinary(command: string, deps: PasswdLookupDeps): string | null {
  const systemPath = (deps.systemBinDirs ?? SYSTEM_BIN_DIRS).join(delimiter)
  const fromSystem = findOnPath(command, { ...process.env, PATH: systemPath })
  if (fromSystem !== null) return fromSystem
  const folders = [process.cwd(), ...(deps.untrustedFolders ?? [])].map(realOrResolved)
  const userPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => !isInsideAny(entry, folders))
    .join(delimiter)
  return findOnPath(command, { ...process.env, PATH: userPath }, process.platform, {
    absoluteOnly: true,
    accept: (candidate) => !isInsideAny(candidate, folders),
  })
}

function readOptionalFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return null
    throw error
  }
}

// NSS modules that read only this host's own files. Any other source (sss, ldap, nis, winbind, compat's NIS lines)
// can be unavailable, and getent reports that the same way as a missing entry.
const LOCAL_PASSWD_SOURCES = new Set(["files", "systemd", "altfiles"])

// Older glibc reads passwd through `compat` when nsswitch.conf is missing or has no passwd line, and compat pulls NIS
// in through `+`/`-` lines in /etc/passwd; without such lines it reads the file alone, as musl and current glibc do.
const hasCompatLines = (passwd: string | null): boolean =>
  passwd !== null && passwd.split("\n").some((line) => line.startsWith("+") || line.startsWith("-"))

/** True when passwd entries come from local files alone, so a missing entry proves the account does not exist. */
function passwdComesFromLocalFilesOnly(nsswitch: string | null, passwdFile: () => string | null): boolean {
  const line = nsswitch
    ?.split("\n")
    .map((raw) => raw.replace(/#.*/, "").trim())
    .find((candidate) => /^passwd\s*:/.test(candidate))
  if (line === undefined) return !hasCompatLines(passwdFile())
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
function isNoSuchAccount(error: unknown, platform: NodeJS.Platform, deps: PasswdLookupDeps): boolean {
  if (platform === "darwin" || typeof error !== "object" || error === null) return false
  if (Reflect.get(error, "status") !== 2) return false
  try {
    return passwdComesFromLocalFilesOnly(
      (deps.nsswitch ?? (() => readOptionalFile("/etc/nsswitch.conf")))(),
      deps.passwdFile ?? (() => readOptionalFile("/etc/passwd")),
    )
  } catch {
    return false
  }
}

/**
 * The passwd entry of the account with this uid through the lookup binary (`getent`, or `id -P` on macOS) from the
 * system bin directories or else an absolute PATH entry outside the current directory and `untrustedFolders`, so
 * hosts that keep it elsewhere still answer. Null when there provably is no such account; throws when the binary is
 * missing or the lookup fails.
 */
export function runPasswdLookup(uid: number, deps: PasswdLookupDeps = {}): string | null {
  const platform = deps.platform ?? process.platform
  const [command, args] = platform === "darwin" ? ["id", ["-P", String(uid)]] : ["getent", ["passwd", String(uid)]]
  const file = deps.which === undefined ? findLookupBinary(command, deps) : deps.which(command)
  if (file === null) throw new Error(`${command} is not on PATH`)
  try {
    return (deps.exec ?? execLookup)(file, args)
  } catch (error) {
    if (isNoSuchAccount(error, platform, deps)) return null
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
