import { describe, expect, test } from "bun:test"
import { acquireMigrationLock, migrationLockPath } from "../index"
import { MemoryMigrationFileSystem, migrationFixture } from "./migration-test-support"

describe("acquireMigrationLock", () => {
  test("#given an expired lock owned by a dead process #when acquiring #then compare-and-remove takeover creates a new owner lease", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const path = migrationLockPath(migrationFixture.env)
    fileSystem.files.set(path, `${JSON.stringify({ leaseExpiresAt: 1, pid: 99 })}\n`)

    // when
    const lock = acquireMigrationLock({
      clock: { now: () => 10 },
      env: migrationFixture.env,
      fileSystem,
      process: { isAlive: () => false, pid: 100 },
    })

    // then
    expect(lock).not.toBeNull()
    expect(fileSystem.readFileSync(path, "utf-8")).toContain(`"pid":100`)
    expect(fileSystem.operations).toContain(`remove:${path}`)
    lock?.release()
  })

  test("#given a lock owner #when the lease is renewed #then its timestamp is replaced before release", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    let now = 10
    const path = migrationLockPath(migrationFixture.env)
    const lock = acquireMigrationLock({
      clock: { now: () => now },
      env: migrationFixture.env,
      fileSystem,
      leaseDurationMs: 5,
      process: { isAlive: () => true, pid: 100 },
    })
    if (lock === null) throw new Error("Expected migration lock")

    // when
    now = 20
    lock.renew()

    // then
    expect(fileSystem.readFileSync(path, "utf-8")).toContain(`"leaseExpiresAt":25`)
    expect(fileSystem.operations).toContain(`replace:${path}`)
    lock.release()
    expect(fileSystem.existsSync(path)).toBe(false)
  })
})
