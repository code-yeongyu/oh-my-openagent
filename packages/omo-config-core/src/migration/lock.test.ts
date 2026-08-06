import { describe, expect, test } from "bun:test"
import { acquireMigrationLock, migrationLockPath } from "../index"
import { MemoryMigrationFileSystem, migrationFixture } from "./migration-test-support"

function fileExistsError(path: string): Error {
  const error = new Error(`Already exists ${path}`)
  Object.defineProperty(error, "code", { value: "EEXIST" })
  return error
}

class ReleaseContentionFileSystem extends MemoryMigrationFileSystem {
  guardWriteAttempts = 0

  constructor(private readonly releaseGuardAfterRead: boolean) {
    super()
  }

  override readFileSync(path: string, encoding: "utf-8"): string {
    const content = super.readFileSync(path, encoding)
    if (this.releaseGuardAfterRead && path.endsWith(".migration.lock.guard") && content.includes(`"pid":99`)) {
      this.files.delete(path)
    }
    return content
  }

  override writeFileExclusiveSync(path: string, content: string): void {
    if (path.endsWith(".migration.lock.guard")) {
      this.guardWriteAttempts += 1
      if (!this.releaseGuardAfterRead || this.guardWriteAttempts === 1) {
        this.files.set(path, `${JSON.stringify({ leaseExpiresAt: 1_000, pid: 99 })}\n`)
        throw fileExistsError(path)
      }
    }
    super.writeFileExclusiveSync(path, content)
  }
}

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

  test("#given a fresh lock owned by a live process #when acquiring #then the active owner is not displaced", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const path = migrationLockPath(migrationFixture.env)
    const content = `${JSON.stringify({ leaseExpiresAt: 100, pid: 99 })}\n`
    fileSystem.files.set(path, content)

    // when
    const lock = acquireMigrationLock({
      clock: { now: () => 50 },
      env: migrationFixture.env,
      fileSystem,
      process: { isAlive: () => true, pid: 100 },
    })

    // then
    expect(lock).toBeNull()
    expect(fileSystem.readFileSync(path, "utf-8")).toBe(content)
  })

  test("#given a live owner whose lease only just expired #when acquiring #then the safety margin prevents premature takeover", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const path = migrationLockPath(migrationFixture.env)
    const content = `${JSON.stringify({ leaseExpiresAt: 99, pid: 99 })}\n`
    fileSystem.files.set(path, content)

    // when
    const lock = acquireMigrationLock({
      clock: { now: () => 100 },
      env: migrationFixture.env,
      fileSystem,
      leaseDurationMs: 10,
      process: { isAlive: () => true, pid: 100 },
    })

    // then
    expect(lock).toBeNull()
    expect(fileSystem.readFileSync(path, "utf-8")).toBe(content)
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

  test("#given transient mutation guard contention #when the owner releases #then it retries and removes the lock", () => {
    // given
    const fileSystem = new ReleaseContentionFileSystem(true)
    const path = migrationLockPath(migrationFixture.env)
    const lock = acquireMigrationLock({
      clock: { now: () => 10 },
      env: migrationFixture.env,
      fileSystem,
      process: { isAlive: (pid) => pid === 99, pid: 100 },
    })
    if (lock === null) throw new Error("Expected migration lock")

    // when
    lock.release()

    // then
    expect(fileSystem.guardWriteAttempts).toBeGreaterThan(1)
    expect(fileSystem.existsSync(path)).toBe(false)
  })

  test("#given persistent mutation guard contention #when release retries are exhausted #then the ownership-matched fallback removes the lock", () => {
    // given
    const fileSystem = new ReleaseContentionFileSystem(false)
    const path = migrationLockPath(migrationFixture.env)
    const lock = acquireMigrationLock({
      clock: { now: () => 10 },
      env: migrationFixture.env,
      fileSystem,
      process: { isAlive: (pid) => pid === 99, pid: 100 },
    })
    if (lock === null) throw new Error("Expected migration lock")

    // when
    lock.release()

    // then
    expect(fileSystem.guardWriteAttempts).toBe(6)
    expect(fileSystem.existsSync(path)).toBe(false)
  })

  test("#given a stale mutation guard owned by a live process #when taking over and releasing #then the guard cannot wedge either mutation", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const path = migrationLockPath(migrationFixture.env)
    const guardPath = `${path}.guard`
    const staleOwnerContent = `${JSON.stringify({ leaseExpiresAt: 1, pid: 99 })}\n`
    fileSystem.files.set(path, staleOwnerContent)
    fileSystem.files.set(guardPath, staleOwnerContent)

    // when
    const lock = acquireMigrationLock({
      clock: { now: () => 100_000 },
      env: migrationFixture.env,
      fileSystem,
      process: { isAlive: (pid) => pid === 99, pid: 100 },
    })
    if (lock === null) throw new Error("Expected stale guard takeover")
    fileSystem.files.set(guardPath, staleOwnerContent)
    lock.release()

    // then
    expect(fileSystem.existsSync(path)).toBe(false)
    expect(fileSystem.existsSync(guardPath)).toBe(false)
  })
})
