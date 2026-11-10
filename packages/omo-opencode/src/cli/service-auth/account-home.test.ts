// #12978: the credential lock lives where the OS user record says, never where $HOME or %USERPROFILE% points, and a
// record home that cannot hold the lock falls back to homedir() with one warning instead of failing the sign-in.
import { describe, expect, onTestFinished, test } from "bun:test"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { type AccountFacts, accountHome, chooseLockHome, lockDirectoryIn, type PlatformFacts, systemAccountFacts, useAccountFacts, userRecordHome } from "./account-home"
import { credentialLockPaths, heldCredentialLease, withCredentialLock } from "./credential-lock"
import type { CredentialStore } from "./keystore"
import type { Credentials } from "./protocol"
import { createSession } from "./session"
import { grant, privateKeys, temporaryHome } from "./test-support"

const API = "https://api.example.test"
const refuse = (what: string) => () => { throw new Error(`unexpected ${what}`) }

function platform(overrides: Partial<PlatformFacts> & Pick<PlatformFacts, "platform">): PlatformFacts {
  return { uid: 501, env: { HOME: "/scratch/home", USERPROFILE: "C:\\scratch" }, readFile: refuse("readFile"), run: refuse("run"), ...overrides }
}

describe("userRecordHome reads the OS user record, never the environment", () => {
  test("linux: the passwd entry of the uid", () => {
    const passwd = "root:x:0:0:root:/root:/bin/bash\nalice:x:501:501::/home/alice:/bin/bash\n"
    expect(userRecordHome(platform({ platform: "linux", readFile: () => passwd }))).toBe("/home/alice")
    expect(userRecordHome(platform({ platform: "linux", uid: 777, readFile: () => passwd }))).toBeUndefined()
    expect(userRecordHome(platform({ platform: "linux", readFile: () => { throw new Error("ENOENT") } }))).toBeUndefined()
  })

  test("darwin: the home field of `id -P`, looked up by uid", () => {
    const calls: string[][] = []
    const run = (command: string, args: readonly string[]) => {
      calls.push([command, ...args])
      return "alice:********:501:20::0:0:Alice:/Users/alice:/bin/zsh\n"
    }
    expect(userRecordHome(platform({ platform: "darwin", run }))).toBe("/Users/alice")
    expect(calls).toEqual([["/usr/bin/id", "-P"]])
    expect(userRecordHome(platform({ platform: "darwin", uid: 502, run }))).toBeUndefined()
    expect(userRecordHome(platform({ platform: "darwin", run: () => { throw new Error("no id") } }))).toBeUndefined()
  })

  test("win32: the registry profile path of the token's SID, with system variables expanded", () => {
    const sid = "S-1-5-21-1111111111-2222222222-3333333333-1001"
    const key = `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\${sid}`
    const run = (command: string, args: readonly string[]) => {
      if (command === "whoami") return `"desktop-1\\alice","${sid}"\r\n`
      if (command === "reg" && args[1] === key) return `\r\n${key}\r\n    ProfileImagePath    REG_EXPAND_SZ    %SystemDrive%\\Users\\alice\r\n\r\n`
      throw new Error(`unexpected ${command} ${args.join(" ")}`)
    }
    expect(userRecordHome(platform({ platform: "win32", uid: undefined, env: { SystemDrive: "C:", USERPROFILE: "D:\\scratch" }, run }))).toBe("C:\\Users\\alice")
    expect(userRecordHome(platform({ platform: "win32", uid: undefined, env: {}, run }))).toBeUndefined()
    expect(userRecordHome(platform({ platform: "win32", uid: undefined, run: () => "no sid here" }))).toBeUndefined()
  })

  test("a platform without a user record lookup names none", () => {
    expect(userRecordHome(platform({ platform: "freebsd" }))).toBeUndefined()
  })
})

function facts(overrides: Partial<AccountFacts>): AccountFacts & { readonly warnings: string[]; readonly prepared: string[] } {
  const warnings: string[] = []
  const prepared: string[] = []
  return {
    recordHome: () => "/account/home",
    homedir: () => "/scratch/home",
    prepareLockDirectory: directory => { prepared.push(directory) },
    warn: message => { warnings.push(message) },
    ...overrides,
    warnings, prepared,
  }
}

describe("chooseLockHome", () => {
  test("the record's home wins over $HOME once its lock directory is ready", () => {
    const f = facts({})
    expect(chooseLockHome(f)).toBe("/account/home")
    expect(f.prepared).toEqual([lockDirectoryIn("/account/home")])
    expect(f.warnings).toEqual([])
  })

  test("no record, or a record equal to $HOME, keeps homedir() without probing", () => {
    for (const recordHome of [() => undefined, () => "/scratch/home"]) {
      const f = facts({ recordHome })
      expect(chooseLockHome(f)).toBe("/scratch/home")
      expect(f.prepared).toEqual([])
      expect(f.warnings).toEqual([])
    }
  })

  test("an unusable record home falls back to homedir() with one warning naming both", () => {
    const f = facts({ prepareLockDirectory: () => { throw Object.assign(new Error("read-only"), { code: "EROFS" }) } })
    expect(chooseLockHome(f)).toBe("/scratch/home")
    expect(f.warnings).toHaveLength(1)
    expect(f.warnings[0]).toContain("/account/home")
    expect(f.warnings[0]).toContain("/scratch/home")
    expect(f.warnings[0]).toContain("EROFS")
  })
})

describe("the default lock home of a process", () => {
  async function unwritableAccount() {
    const root = await temporaryHome()
    const blocker = join(root, "not-a-directory")
    await writeFile(blocker, "")
    const home = join(root, "home")
    const warnings: string[] = []
    const previous = useAccountFacts({
      ...systemAccountFacts, recordHome: () => join(blocker, "account-home"), homedir: () => home, warn: message => { warnings.push(message) },
    })
    onTestFinished(() => { useAccountFacts(previous) })
    return { home, warnings }
  }

  test("is chosen once: repeated lock use warns once and keeps one path", async () => {
    const { home, warnings } = await unwritableAccount()
    expect(accountHome()).toBe(home)
    expect(accountHome()).toBe(home)
    const [first, nested] = await withCredentialLock(API, async () => [credentialLockPaths(API).lock, heldCredentialLease(API) !== undefined] as const)
    expect(first).toBe(credentialLockPaths(API, home).lock)
    expect(nested).toBe(true)
    expect(warnings).toHaveLength(1)
  })

  test("a sign-in saves through the fallback lock when the account home cannot hold it", async () => {
    const { home, warnings } = await unwritableAccount()
    let stored: Credentials | null = null
    const store: CredentialStore = {
      read: async () => stored,
      readAuthoritative: async () => stored,
      write: async value => { stored = value },
      clear: async () => { stored = null },
    }
    const session = createSession({ api: API, store, beforeKeysDiscarded: async () => undefined })
    const credentials: Credentials = { ...grant, ...privateKeys, accountId: "account-a", credentialGeneration: "generation-a" }
    await session.save(credentials)
    expect(stored).toEqual(credentials)
    expect(existsSync(lockDirectoryIn(home))).toBe(true)
    expect(warnings).toHaveLength(1)
  })
})
