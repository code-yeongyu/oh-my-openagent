/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"

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
    const { lookupHomeOfUid, OWNER_LOOKUP_FAILURE_TTL_MS } = projectModelProfileRpc
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
    clock += OWNER_LOOKUP_FAILURE_TTL_MS - 1
    expect(lookupHomeOfUid(424242, run, now)).toBeUndefined()
    expect(calls).toBe(1)

    clock += 1
    expect(lookupHomeOfUid(424242, run, now)).toBe("/var/lib/svc")
    expect(calls).toBe(2)
  })

  test("#given no such account #when it is asked again after the retry window #then a later answer is used", () => {
    const { lookupHomeOfUid, OWNER_LOOKUP_FAILURE_TTL_MS } = projectModelProfileRpc
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
    clock += OWNER_LOOKUP_FAILURE_TTL_MS
    expect(lookupHomeOfUid(424244, run, now)).toBe("/var/lib/svc2")
    expect(calls).toBe(2)
  })

  test("#given a found owner home #when it is asked again long after #then it is reused without a second lookup", () => {
    const { lookupHomeOfUid, OWNER_LOOKUP_FAILURE_TTL_MS } = projectModelProfileRpc
    let clock = 3_000_000
    const now = () => clock
    let calls = 0
    const run = () => {
      calls += 1
      return "svc:x:424243:424243::/var/lib/svc:/bin/sh\n"
    }

    expect(lookupHomeOfUid(424243, run, now)).toBe("/var/lib/svc")
    clock += OWNER_LOOKUP_FAILURE_TTL_MS * 100
    expect(lookupHomeOfUid(424243, run, now)).toBe("/var/lib/svc")
    expect(calls).toBe(1)
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
