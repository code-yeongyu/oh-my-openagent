import { describe, expect, test } from "bun:test"
import { runMigration, updateOmoConfig } from "../index"
import { MemoryMigrationFileSystem, migrationFixture, parseFile } from "./migration-test-support"

describe("runMigration transaction ownership", () => {
  test("#given two callers overlap #when one holds the exclusive lock #then one migration commits and the other observes completed state on retry", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    let concurrentStatus = ""
    fileSystem.files.set(migrationFixture.sourcePath, `{}`)
    const input = {
      env: migrationFixture.env,
      fileSystem,
      id: "concurrent-legacy",
      pid: 100,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ task: { default_concurrency: 3 } }),
    }

    // when
    const first = runMigration({
      ...input,
      writeTarget: (writeInput) => {
        concurrentStatus = runMigration({ ...input, pid: 200 }).status
        updateOmoConfig({
          edits: writeInput.edits,
          env: writeInput.env,
          fileSystem: writeInput.fileSystem,
          scope: "user",
        })
      },
    })
    const second = runMigration({ ...input, pid: 200 })

    // then
    expect(first.status).toBe("migrated")
    expect(concurrentStatus).toBe("locked")
    expect(second.status).toBe("skipped")
    expect(parseFile(fileSystem, migrationFixture.targetPath)._migrations).toEqual(["concurrent-legacy"])
  })

  test("#given a live owner whose lease is fresh #when another caller attempts takeover #then the lock is not stolen", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const lockPath = "/home/alice/.omo/.migration.lock"
    const lockContent = `${JSON.stringify({ leaseExpiresAt: 2_000, pid: 99 })}\n`
    fileSystem.files.set(lockPath, lockContent)
    fileSystem.files.set(migrationFixture.sourcePath, `{}`)

    // when
    const result = runMigration({
      clock: { now: () => 1_000 },
      env: migrationFixture.env,
      fileSystem,
      id: "live-owner",
      isProcessAlive: (pid) => pid === 99,
      pid: 100,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ task: { default_concurrency: 3 } }),
    })

    // then
    expect(result.status).toBe("locked")
    expect(fileSystem.readFileSync(lockPath, "utf-8")).toBe(lockContent)
    expect(fileSystem.existsSync(migrationFixture.sourcePath)).toBe(true)
    expect(fileSystem.existsSync(migrationFixture.targetPath)).toBe(false)
  })

  test("#given a migration lasts beyond its initial lease #when it renews at transaction boundaries #then fresh ownership is never stolen", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    let now = 0
    const competingStatuses: string[] = []
    fileSystem.files.set(migrationFixture.sourcePath, `{}`)
    const input = {
      clock: { now: () => now },
      env: migrationFixture.env,
      fileSystem,
      id: "renewing-owner",
      isProcessAlive: () => true,
      leaseDurationMs: 10,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ task: { default_concurrency: 3 } }),
    }
    const race = (): void => {
      competingStatuses.push(runMigration({ ...input, pid: 200 }).status)
    }

    // when
    const result = runMigration({
      ...input,
      onBoundary: (boundary) => {
        if (boundary === "journal-written") {
          now = 8
          race()
        }
        if (boundary === "source-moved") {
          now = 24
          race()
        }
      },
      pid: 100,
      writeTarget: (writeInput) => {
        now = 16
        race()
        updateOmoConfig({
          edits: writeInput.edits,
          env: writeInput.env,
          fileSystem: writeInput.fileSystem,
          scope: "user",
        })
      },
    })

    // then
    expect(result.status).toBe("migrated")
    expect(competingStatuses).toEqual(["locked", "locked", "locked"])
    expect(parseFile(fileSystem, migrationFixture.targetPath)._migrations).toEqual(["renewing-owner"])
  })

  test("#given a false predicate and no journal #when entering the transaction #then no target or source is written", () => {
    // given
    const noSourceFileSystem = new MemoryMigrationFileSystem()
    const markedFileSystem = new MemoryMigrationFileSystem()
    markedFileSystem.files.set(migrationFixture.sourcePath, `{}`)
    markedFileSystem.files.set(migrationFixture.targetPath, `{"_migrations":["already-done"]}`)

    // when
    const noSource = runMigration({
      env: migrationFixture.env,
      fileSystem: noSourceFileSystem,
      id: "absent-source",
      pid: 100,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ task: { default_concurrency: 3 } }),
    })
    const marked = runMigration({
      env: migrationFixture.env,
      fileSystem: markedFileSystem,
      id: "already-done",
      pid: 100,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ task: { default_concurrency: 3 } }),
    })

    // then
    expect(noSource.status).toBe("skipped")
    expect(marked.status).toBe("skipped")
    expect(noSourceFileSystem.existsSync(migrationFixture.targetPath)).toBe(false)
    expect(markedFileSystem.existsSync(migrationFixture.sourcePath)).toBe(true)
    expect(markedFileSystem.files.get(migrationFixture.targetPath)).toBe(`{"_migrations":["already-done"]}`)
    expect(noSourceFileSystem.existsSync("/home/alice/.omo/.migration-journal.json")).toBe(false)
    expect(markedFileSystem.existsSync("/home/alice/.omo/.migration-journal.json")).toBe(false)
  })
})
