import { describe, expect, test } from "bun:test"

import { migrationJournalPath, runMigrations } from "../index"
import { MemoryMigrationFileSystem, migrationFixture, parseFile } from "./migration-test-support"

describe("runMigrations", () => {
  test("#given a long-expired lock owned by a live process #when the next batch starts #then it reclaims the stale lease and completes", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const lockPath = "/home/alice/.omo/.migration.lock"
    fileSystem.files.set(lockPath, `${JSON.stringify({ leaseExpiresAt: 1, pid: 99 })}\n`)
    fileSystem.files.set(migrationFixture.sourcePath, `{}`)

    // when
    const result = runMigrations({
      clock: { now: () => 100_000 },
      discover: () => [{
        id: "stale-live-owner",
        sources: [{ path: migrationFixture.sourcePath }],
        targetPath: migrationFixture.targetPath,
        transform: () => ({ task: { default_concurrency: 3 } }),
      }],
      env: migrationFixture.env,
      fileSystem,
      isProcessAlive: (pid) => pid === 99,
      pid: 100,
    })

    // then
    expect(result.status).toBe("completed")
    expect(result.results.map((entry) => entry.status)).toEqual(["migrated"])
    expect(parseFile(fileSystem, migrationFixture.targetPath)._migrations).toEqual(["stale-live-owner"])
    expect(fileSystem.existsSync(lockPath)).toBe(false)
  })

  test("#given a pending journal #when plans are discovered #then recovery finishes before discovery and dry run creates no new migration writes", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const backupPath = `${migrationFixture.sourcePath}.backup`
    fileSystem.files.set(migrationFixture.sourcePath, "{}")
    fileSystem.files.set(migrationJournalPath(migrationFixture.env), `${JSON.stringify({
      backupMoves: [{ from: migrationFixture.sourcePath, to: backupPath }],
      completedMoves: [],
      migrationId: "recovery",
      targetPath: migrationFixture.targetPath,
      targetWrite: { additions: { task: { default_concurrency: 3 } } },
      targetWritten: false,
      version: 1,
    })}\n`)
    let discoveryAfterRecovery = false

    // when
    const result = runMigrations({
      discover: () => {
        discoveryAfterRecovery = fileSystem.existsSync(backupPath) && !fileSystem.existsSync(migrationJournalPath(migrationFixture.env))
        return [{
          id: "preview",
          sources: [{ path: "/legacy/preview.jsonc" }],
          targetPath: migrationFixture.targetPath,
          transform: () => ({ task: { default_concurrency: 4 } }),
        }]
      },
      dryRun: true,
      env: migrationFixture.env,
      fileSystem,
      isProcessAlive: () => false,
      pid: 100,
    })

    // then
    expect(discoveryAfterRecovery).toBe(true)
    expect(result.journalResumed).toBe(true)
    expect(result.results[0]?.status).toBe("skipped")
    expect(parseFile(fileSystem, migrationFixture.targetPath).task).toEqual({ default_concurrency: 3 })
    expect(fileSystem.existsSync("/legacy/preview.jsonc")).toBe(false)
  })
})
