import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createSessionLocks } from "../src/index.ts"
import { tempDirs } from "./support/tmp.ts"

const temp = tempDirs("omo-hand-locks-")

describe("per-session lock files the engine's self set reads", () => {
  it("host_writes_one_lock_file_per_local_session", () => {
    // Given two brain processes with local sessions, the first holding two.
    const dir = join(temp(), "sessions")
    const locks = createSessionLocks(dir)
    const first = { pid: 4101, processStart: 9001 }
    const releaseA = locks.acquire(first)
    const releaseB = locks.acquire(first)
    const releaseC = locks.acquire({ pid: 4202, processStart: 9002 })

    // Then each process has exactly one 0600 sessions/<pid>.lock naming its pid and start.
    expect(readdirSync(dir).sort()).toEqual(["4101.lock", "4202.lock"])
    expect(JSON.parse(readFileSync(join(dir, "4101.lock"), "utf8"))).toEqual({ pid: 4101, processStart: 9001 })
    expect(statSync(join(dir, "4101.lock")).mode & 0o777).toBe(0o600)

    // When sessions close, a file stays while its process still has an open session.
    releaseA()
    expect(existsSync(join(dir, "4101.lock"))).toBe(true)
    releaseB()
    releaseC()
    expect(readdirSync(dir)).toEqual([])
  })
})
