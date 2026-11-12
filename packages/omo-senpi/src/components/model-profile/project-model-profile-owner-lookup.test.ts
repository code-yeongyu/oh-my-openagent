/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { testTempDir } from "../../../test-support/temp-dir"

import * as projectModelProfileRpc from "./project-model-profile-rpc"

describe("project model_profile RPC owner home lookup (#13207, #13209)", () => {
  test("#given a passwd entry from getent or macOS id -P #when its home is read #then the home field is returned", () => {
    const { homeFromPasswdEntry } = projectModelProfileRpc
    expect(homeFromPasswdEntry("svc:x:998:998::/var/lib/svc:/usr/sbin/nologin\n")).toBe("/var/lib/svc")
    expect(homeFromPasswdEntry("q:********:501:20::0:0:Q Kim:/Users/q name:/bin/zsh")).toBe("/Users/q name")
    expect(homeFromPasswdEntry("")).toBeNull()
    expect(homeFromPasswdEntry("broken:line:relative/home:/bin/sh")).toBeNull()
  })

  test("#given a failed owner lookup #when it is asked again within the retry window #then the failure is reused, and after the window a successful lookup is used", () => {
    const { lookupHomeOfUid, OWNER_LOOKUP_TTL_MS } = projectModelProfileRpc
    let clock = 1_000_000
    const now = () => clock
    let calls = 0
    let lookupWorks = false
    const run = () => {
      calls += 1
      if (!lookupWorks) throw new Error("lookup timed out")
      return "svc:x:424242:424242::/var/lib/svc:/bin/sh\n"
    }

    expect(lookupHomeOfUid(424242, run, now)).toBeUndefined()
    lookupWorks = true
    clock += OWNER_LOOKUP_TTL_MS - 1
    expect(lookupHomeOfUid(424242, run, now)).toBeUndefined()
    expect(calls).toBe(1)

    clock += 1
    expect(lookupHomeOfUid(424242, run, now)).toBe("/var/lib/svc")
    expect(calls).toBe(2)
  })

  test("#given no such account #when it is asked again after the retry window #then a later answer is used", () => {
    const { lookupHomeOfUid, OWNER_LOOKUP_TTL_MS } = projectModelProfileRpc
    let clock = 2_000_000
    const now = () => clock
    let entry = ""
    let calls = 0
    const run = () => {
      calls += 1
      return entry
    }

    expect(lookupHomeOfUid(424244, run, now)).toBeNull()
    entry = "svc:x:424244:424244::/var/lib/svc2:/bin/sh\n"
    expect(lookupHomeOfUid(424244, run, now)).toBeNull()
    clock += OWNER_LOOKUP_TTL_MS
    expect(lookupHomeOfUid(424244, run, now)).toBe("/var/lib/svc2")
    expect(calls).toBe(2)
  })

  test("#given a found owner home #when it is asked again within and after the window #then it is reused within it and looked up again after it", () => {
    const { lookupHomeOfUid, OWNER_LOOKUP_TTL_MS } = projectModelProfileRpc
    let clock = 3_000_000
    const now = () => clock
    let calls = 0
    let entry = "svc:x:424243:424243::/var/lib/svc:/bin/sh\n"
    const run = () => {
      calls += 1
      return entry
    }

    expect(lookupHomeOfUid(424243, run, now)).toBe("/var/lib/svc")
    entry = "svc:x:424243:424243::/srv/moved:/bin/sh\n"
    clock += OWNER_LOOKUP_TTL_MS - 1
    expect(lookupHomeOfUid(424243, run, now)).toBe("/var/lib/svc")
    expect(calls).toBe(1)

    clock += 1
    expect(lookupHomeOfUid(424243, run, now)).toBe("/srv/moved")
    expect(calls).toBe(2)
  })

  // The default runner with its process spawn injected: the lookup binary comes from PATH, and an exit that means
  // "no such account" is told apart from a failed lookup. The passwd sources default to local files only.
  function lookupThroughRunner(
    uid: number,
    platform: NodeJS.Platform,
    exec: (file: string, args: readonly string[]) => string,
    which: (command: string) => string | null = (command) => `/opt/tools/bin/${command}`,
    nsswitch: () => string | null = () => "passwd: files systemd\ngroup: files\n",
  ): string | null | undefined {
    const { lookupHomeOfUid, runPasswdLookup } = projectModelProfileRpc
    return lookupHomeOfUid(
      uid,
      (asked) => runPasswdLookup(asked, { platform, exec, which, nsswitch }),
      () => 4_000_000 + uid,
    )
  }
  const exitError = (status: number, stderr = "") => Object.assign(new Error(`exit ${status}`), { status, stderr })

  test("#given getent or id -P finds the account #when the default runner looks it up #then the binary resolved from PATH is run and its home is returned", () => {
    const calls: string[] = []
    const exec = (file: string, args: readonly string[]) => {
      calls.push([file, ...args].join(" "))
      return file.endsWith("getent")
        ? "svc:x:424250:424250::/var/lib/svc:/bin/sh\n"
        : "svc:********:424251:20::0:0:Svc:/Users/svc:/bin/zsh\n"
    }

    expect(lookupThroughRunner(424250, "linux", exec)).toBe("/var/lib/svc")
    expect(lookupThroughRunner(424251, "darwin", exec)).toBe("/Users/svc")
    expect(calls).toStrictEqual(["/opt/tools/bin/getent passwd 424250", "/opt/tools/bin/id -P 424251"])
  })

  test("#given getent exits 2 and passwd entries come only from local files #when the default runner looks the uid up #then there is no such account", () => {
    const notFound = () => {
      throw exitError(2)
    }

    expect(lookupThroughRunner(424252, "linux", notFound)).toBeNull()
    expect(lookupThroughRunner(424259, "linux", notFound, undefined, () => null)).toBeNull()
  })

  // getent exits 2 and id -P says "no such user" for any missing entry, also when the directory service that would
  // hold it is down, so only a passwd database read from local files alone proves the account is missing.
  test("#given getent exits 2 while passwd also comes from a directory service, or id -P reports no such user #when the default runner looks the uid up #then the lookup failed", () => {
    const notFound = () => {
      throw exitError(2)
    }

    expect(
      lookupThroughRunner(424260, "linux", notFound, undefined, () => "passwd:   files [NOTFOUND=return] sss\n"),
    ).toBeUndefined()
    expect(lookupThroughRunner(424261, "linux", notFound, undefined, () => "passwd: files ldap\n")).toBeUndefined()
    expect(
      lookupThroughRunner(424262, "linux", notFound, undefined, () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
      }),
    ).toBeUndefined()
    expect(
      lookupThroughRunner(424253, "darwin", () => {
        throw exitError(1, "id: 424253: no such user\n")
      }),
    ).toBeUndefined()
  })

  test.skipIf(process.platform === "win32")(
    "#given PATH holds only a relative entry and the session folder ships its own getent and id #when the default runner looks this account up #then the planted binaries never run",
    () => {
      const work = realpathSync(testTempDir("omo-owner-lookup-planted-"))
      const marker = join(work, "planted-ran")
      for (const name of ["getent", "id"]) {
        const planted = join(work, name)
        writeFileSync(planted, `#!/bin/sh\necho ran > "${marker}"\necho "x:x:0:0::/planted:/bin/sh"\n`)
        chmodSync(planted, 0o755)
      }
      const previousPath = process.env.PATH
      const previousCwd = process.cwd()
      process.env.PATH = "."
      process.chdir(work)
      try {
        projectModelProfileRpc.runPasswdLookup(process.getuid?.() ?? 0)
      } catch {
        // A host without the system lookup binary fails the lookup; only whether the planted copy ran matters here.
      } finally {
        process.chdir(previousCwd)
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
      }

      expect(existsSync(marker)).toBe(false)
    },
  )

  test("#given the lookup binary is not on PATH, times out or fails otherwise #when the default runner looks the uid up #then the lookup failed", () => {
    let spawned = 0
    const exec = () => {
      spawned += 1
      return "svc:x:424254:424254::/var/lib/svc:/bin/sh\n"
    }

    expect(lookupThroughRunner(424254, "linux", exec, () => null)).toBeUndefined()
    expect(lookupThroughRunner(424255, "darwin", exec, () => null)).toBeUndefined()
    expect(spawned).toBe(0)
    expect(
      lookupThroughRunner(424256, "linux", () => {
        throw Object.assign(new Error("spawnSync getent ETIMEDOUT"), { code: "ETIMEDOUT" })
      }),
    ).toBeUndefined()
    expect(
      lookupThroughRunner(424257, "linux", () => {
        throw exitError(1)
      }),
    ).toBeUndefined()
    expect(
      lookupThroughRunner(424258, "darwin", () => {
        throw exitError(1, "id: Open Directory unavailable\n")
      }),
    ).toBeUndefined()
  })

  const passwdLookupBinary = process.platform === "darwin" ? "/usr/bin/id" : "/usr/bin/getent"

  // Why the real lookup cannot be checked here, or null when it can. A UID-mapped container can hand this process a
  // passwd home that another uid owns, so the ownership claim does not hold there.
  function realLookupSkipReason(): string | null {
    if (!existsSync(passwdLookupBinary)) return `${passwdLookupBinary} is absent`
    const uid = process.getuid?.()
    if (uid === undefined) return null
    const args = process.platform === "darwin" ? ["-P", String(uid)] : ["passwd", String(uid)]
    const home = projectModelProfileRpc.homeFromPasswdEntry(
      execFileSync(passwdLookupBinary, args, { encoding: "utf8" }),
    )
    if (home === null || !existsSync(home)) return "this account has no passwd home on disk"
    const owner = statSync(home).uid
    return owner === uid ? null : `the passwd home is owned by uid ${owner}, not this process's uid ${uid} (UID-mapped)`
  }
  const realLookupSkip = realLookupSkipReason()

  test.skipIf(realLookupSkip !== null)(
    `#given this platform's passwd lookup (${passwdLookupBinary}; ${realLookupSkip === null ? "runs" : `skipped: ${realLookupSkip}`}) #when this account's home is looked up through the default path #then an absolute folder this account owns is returned`,
    () => {
      const uid = process.getuid?.()
      if (uid === undefined)
        throw new Error("process.getuid is missing on a platform that ships the passwd lookup binary")

      const home = projectModelProfileRpc.lookupHomeOfUid(uid)

      expect(typeof home === "string" && home.startsWith("/")).toBe(true)
      expect(statSync(home as string).uid).toBe(uid)
    },
  )
})
