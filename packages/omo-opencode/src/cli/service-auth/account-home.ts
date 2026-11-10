import { execFileSync } from "node:child_process"
import { accessSync, constants, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, posix, win32 } from "node:path"

/** What the OS says about the user running this process; tests pass their own (#12978). */
export interface PlatformFacts {
  readonly platform: NodeJS.Platform
  readonly uid: number | undefined
  readonly env: Readonly<Record<string, string | undefined>>
  readonly readFile: (path: string) => string
  readonly run: (command: string, args: readonly string[]) => string
}

/** What the default lock home is chosen from. Tests and fixtures pass their own; there is no environment override (#12978). */
export interface AccountFacts {
  /** The home the OS user record names, independent of $HOME and %USERPROFILE%; undefined when the OS cannot say. */
  readonly recordHome: () => string | undefined
  /** $HOME or %USERPROFILE%: the lock home before #12978, and the fallback when the record's home cannot hold the lock. */
  readonly homedir: () => string
  /** Creates the lock directory and proves it writable, or throws. */
  readonly prepareLockDirectory: (directory: string) => void
  readonly warn: (message: string) => void
}

export const lockDirectoryIn = (home: string): string => join(home, ".omo", "session-locks")

/**
 * The OS user record's home. The credential item belongs to the OS user (the Secret Service on the session bus, the
 * login Keychain, Credential Manager), not to $HOME, and Bun's homedir() and userInfo() both answer $HOME/%USERPROFILE%.
 */
export function userRecordHome(facts: PlatformFacts): string | undefined {
  try {
    if (facts.platform === "linux") return passwdHome(facts)
    if (facts.platform === "darwin") return darwinHome(facts)
    if (facts.platform === "win32") return windowsProfile(facts)
    return undefined
  } catch {
    // No record to read (a minimal container without a passwd file, a missing tool): $HOME is the only home left.
    return undefined
  }
}

function passwdHome(facts: PlatformFacts): string | undefined {
  if (facts.uid === undefined) return undefined
  const uid = String(facts.uid)
  const home = facts.readFile("/etc/passwd").split("\n").map(line => line.split(":")).find(fields => fields[2] === uid)?.[5]
  return home !== undefined && posix.isAbsolute(home) ? home : undefined
}

// `id -P` prints the real uid's record in master.passwd form (name:password:uid:gid:class:change:expire:gecos:home:shell),
// looked up through Open Directory, never from $HOME.
function darwinHome(facts: PlatformFacts): string | undefined {
  const fields = facts.run("/usr/bin/id", ["-P"]).trim().split(":")
  const home = fields[8]
  if (facts.uid !== undefined && fields[2] !== String(facts.uid)) return undefined
  return home !== undefined && posix.isAbsolute(home) ? home : undefined
}

// The profile directory the registry records for the token's SID; %USERPROFILE% only defaults to it.
function windowsProfile(facts: PlatformFacts): string | undefined {
  const sid = /S-1-[0-9-]+/.exec(facts.run("whoami", ["/user", "/fo", "csv", "/nh"]))?.[0]
  if (sid === undefined) return undefined
  const key = `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\${sid}`
  const value = /ProfileImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(facts.run("reg", ["query", key, "/v", "ProfileImagePath"]))?.[1]?.trim()
  const home = value?.replace(/%([^%]+)%/g, (whole, name: string) => facts.env[name] ?? whole)
  return home !== undefined && !home.includes("%") && win32.isAbsolute(home) ? home : undefined
}

/**
 * The record's home when it can hold the lock; otherwise today's homedir() with one warning, so a read-only or missing
 * account home never fails a sign-in because of where the lock lives.
 */
export function chooseLockHome(facts: AccountFacts): string {
  const home = facts.homedir()
  const record = facts.recordHome()
  if (record === undefined || record === home) return home
  try {
    facts.prepareLockDirectory(lockDirectoryIn(record))
    return record
  } catch (error) {
    const reason = error instanceof Error && "code" in error ? String(error.code) : String(error)
    facts.warn(`omo: the account home ${record} cannot hold the credential lock (${reason}); using ${home}. A process started with another HOME may refresh the same sign-in at the same time (#12978).`)
    return home
  }
}

export const systemPlatformFacts: PlatformFacts = {
  platform: process.platform,
  uid: process.getuid?.(),
  env: process.env,
  readFile: path => readFileSync(path, "utf8"),
  run: (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, windowsHide: true }),
}

export const systemAccountFacts: AccountFacts = {
  recordHome: () => userRecordHome(systemPlatformFacts),
  homedir,
  prepareLockDirectory: directory => {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    accessSync(directory, constants.W_OK)
  },
  warn: message => process.stderr.write(`${message}\n`),
}

let facts = systemAccountFacts
let chosen: string | undefined

/** Where every process of this OS user meets on one credential lock, chosen once per process (#12978). */
export function accountHome(): string {
  chosen ??= chooseLockHome(facts)
  return chosen
}

/** Test preloads and fixtures only; returns the facts it replaced. */
export function useAccountFacts(next: AccountFacts): AccountFacts {
  const previous = facts
  facts = next
  chosen = undefined
  return previous
}
