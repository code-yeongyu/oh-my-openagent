// #12978: the credential lock lives where the OS user record says, never where $HOME or %USERPROFILE% points, and a
// record home that cannot hold the lock falls back to homedir() with one warning instead of failing the sign-in.
import { describe, expect, onTestFinished, test } from "bun:test"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  type AccountFacts,
  accountHome,
  chooseLockHome,
  lockDirectoryIn,
  type PlatformFacts,
  systemAccountFacts,
  TEST_LOCK_HOME_ENV,
  testLockHome,
  useAccountFacts,
  userRecordHome,
} from "./account-home"
import { credentialLockPaths, heldCredentialLease, withCredentialLock } from "./credential-lock"
import type { CredentialStore } from "./keystore"
import type { Credentials } from "./protocol"
import { createSession } from "./session"
import { grant, privateKeys, temporaryHome } from "./test-support"

const API = "https://api.example.test"
const refuse = (what: string) => () => {
  throw new Error(`unexpected ${what}`)
}

function platform(overrides: Partial<PlatformFacts> & Pick<PlatformFacts, "platform">): PlatformFacts {
  return {
    uid: 501,
    env: { HOME: "/scratch/home", USERPROFILE: "C:\\scratch" },
    readFile: refuse("readFile"),
    isFile: refuse("isFile"),
    run: refuse("run"),
    ...overrides,
  }
}

describe("userRecordHome reads the OS user record, never the environment", () => {
  test("linux: the passwd entry of the uid", () => {
    const passwd = "root:x:0:0:root:/root:/bin/bash\nalice:x:501:501::/home/alice:/bin/bash\n"
    expect(userRecordHome(platform({ platform: "linux", readFile: () => passwd }))).toBe("/home/alice")
    expect(userRecordHome(platform({ platform: "linux", uid: 777, readFile: () => passwd }))).toBeUndefined()
    expect(
      userRecordHome(
        platform({
          platform: "linux",
          readFile: () => {
            throw new Error("ENOENT")
          },
        }),
      ),
    ).toBeUndefined()
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
    expect(
      userRecordHome(
        platform({
          platform: "darwin",
          run: () => {
            throw new Error("no id")
          },
        }),
      ),
    ).toBeUndefined()
  })

  const WHOAMI = "C:\\Windows\\System32\\whoami.exe"
  const REG = "C:\\Windows\\System32\\reg.exe"
  const systemTools = (path: string) => path === WHOAMI || path === REG

  test("win32: the registry profile path of the token's SID, with system variables expanded", () => {
    const sid = "S-1-5-21-1111111111-2222222222-3333333333-1001"
    const key = `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\${sid}`
    const run = (command: string, args: readonly string[]) => {
      if (command === WHOAMI) return `"desktop-1\\alice","${sid}"\r\n`
      if (command === REG && args[1] === key)
        return `\r\n${key}\r\n    ProfileImagePath    REG_EXPAND_SZ    %SystemDrive%\\Users\\alice\r\n\r\n`
      throw new Error(`unexpected ${command} ${args.join(" ")}`)
    }
    const win = (env: Record<string, string>, runner = run) =>
      platform({
        platform: "win32",
        uid: undefined,
        env: { SystemRoot: "C:\\Windows", ...env },
        isFile: systemTools,
        run: runner,
      })
    expect(userRecordHome(win({ SystemDrive: "C:", USERPROFILE: "D:\\scratch" }))).toBe("C:\\Users\\alice")
    expect(userRecordHome(win({}))).toBeUndefined()
    expect(userRecordHome(win({}, () => "no sid here"))).toBeUndefined()
  })

  // A bare `whoami` or `reg` resolves in the current directory before PATH on Windows, so a repository could plant one.
  test("win32: only %SystemRoot%\\System32\\whoami.exe and reg.exe run, never a bare name", () => {
    const spawned: string[] = []
    const run = (command: string) => {
      spawned.push(command)
      return command === WHOAMI
        ? '"desktop-1\\alice","S-1-5-21-1-2-3-1001"'
        : "    ProfileImagePath    REG_SZ    C:\\Users\\alice"
    }
    const home = userRecordHome(
      platform({ platform: "win32", uid: undefined, env: { SystemRoot: "C:\\Windows" }, isFile: systemTools, run }),
    )
    expect(spawned).toEqual([WHOAMI, REG])
    expect(home).toBe("C:\\Users\\alice")
  })

  test("win32: a missing or invalid SystemRoot, or a missing tool, means no lookup at all", () => {
    const spawned: string[] = []
    const run = (command: string) => {
      spawned.push(command)
      return ""
    }
    for (const env of [
      {},
      { SystemRoot: "Windows" },
      { SystemRoot: "\\\\server\\share\\Windows" },
      { SystemRoot: "C:\\Windows\\..\\repo" },
      { SystemRoot: "" },
    ]) {
      expect(
        userRecordHome(platform({ platform: "win32", uid: undefined, env, isFile: () => true, run })),
      ).toBeUndefined()
    }
    expect(
      userRecordHome(
        platform({ platform: "win32", uid: undefined, env: { SystemRoot: "C:\\Windows" }, isFile: () => false, run }),
      ),
    ).toBeUndefined()
    expect(spawned).toEqual([])
  })

  test("a platform without a user record lookup names none", () => {
    expect(userRecordHome(platform({ platform: "freebsd" }))).toBeUndefined()
  })
})

function facts(
  overrides: Partial<AccountFacts>,
): AccountFacts & { readonly warnings: string[]; readonly prepared: string[] } {
  const warnings: string[] = []
  const prepared: string[] = []
  return {
    recordHome: () => "/account/home",
    homedir: () => "/scratch/home",
    prepareLockDirectory: (directory) => {
      prepared.push(directory)
    },
    warn: (message) => {
      warnings.push(message)
    },
    ...overrides,
    warnings,
    prepared,
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
    const f = facts({
      prepareLockDirectory: () => {
        throw Object.assign(new Error("read-only"), { code: "EROFS" })
      },
    })
    expect(chooseLockHome(f)).toBe("/scratch/home")
    expect(f.warnings).toHaveLength(1)
    expect(f.warnings[0]).toContain("/account/home")
    expect(f.warnings[0]).toContain("/scratch/home")
    expect(f.warnings[0]).toContain("EROFS")
  })
})

describe("the test-only lock home a test hands a CLI child (#12978 review)", () => {
  const marked = { [Symbol.for("omo.test.injectedSecrets")]: true }

  test("is honored only next to a test stand-in credential store", () => {
    expect(testLockHome({ [TEST_LOCK_HOME_ENV]: "/tmp/child-home" }, marked)).toBe("/tmp/child-home")
    expect(testLockHome({ [TEST_LOCK_HOME_ENV]: "C:\\tmp\\child-home" }, marked)).toBe("C:\\tmp\\child-home")
    for (const secrets of [undefined, null, {}, { [Symbol.for("omo.test.injectedSecrets")]: "true" }]) {
      expect(testLockHome({ [TEST_LOCK_HOME_ENV]: "/tmp/child-home" }, secrets)).toBeUndefined()
    }
  })

  test("an empty or relative value is ignored", () => {
    for (const value of [undefined, "", "relative/home"])
      expect(testLockHome({ [TEST_LOCK_HOME_ENV]: value }, marked)).toBeUndefined()
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
      ...systemAccountFacts,
      recordHome: () => join(blocker, "account-home"),
      homedir: () => home,
      warn: (message) => {
        warnings.push(message)
      },
    })
    onTestFinished(() => {
      useAccountFacts(previous)
    })
    return { home, warnings }
  }

  test("is chosen once: repeated lock use warns once and keeps one path", async () => {
    const { home, warnings } = await unwritableAccount()
    expect(accountHome()).toBe(home)
    expect(accountHome()).toBe(home)
    const [first, nested] = await withCredentialLock(
      API,
      async () => [credentialLockPaths(API).lock, heldCredentialLease(API) !== undefined] as const,
    )
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
      write: async (value) => {
        stored = value
      },
      clear: async () => {
        stored = null
      },
    }
    const session = createSession({ api: API, store, beforeKeysDiscarded: async () => undefined })
    const credentials: Credentials = {
      ...grant,
      ...privateKeys,
      accountId: "account-a",
      credentialGeneration: "generation-a",
    }
    await session.save(credentials)
    expect(stored).toEqual(credentials)
    expect(existsSync(lockDirectoryIn(home))).toBe(true)
    expect(warnings).toHaveLength(1)
  })
})
