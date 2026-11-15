// #12989: a credential lock whose record was torn by a crash (the exclusive create landed, the
// record write did not) must be reclaimed, not waited on for the full lock-wait bound on every call.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { credentialLockPaths, withCredentialLock } from "./credential-lock"

const API = "https://api.omo.dev"
const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("withCredentialLock", () => {
  test("#given an empty lock record left by a crash an hour ago #when the lock is taken #then it is reclaimed at once", async () => {
    const home = mkdtempSync(join(tmpdir(), "credlock-torn-"))
    homes.push(home)
    const { directory, lock } = credentialLockPaths(API, home)
    mkdirSync(directory, { recursive: true })
    writeFileSync(lock, "")
    const anHourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(lock, anHourAgo, anHourAgo)

    const started = performance.now()
    const value = await withCredentialLock(API, async () => "ran", home)

    expect(value).toBe("ran")
    expect(performance.now() - started).toBeLessThan(2_000)
  }, 20_000)
})
