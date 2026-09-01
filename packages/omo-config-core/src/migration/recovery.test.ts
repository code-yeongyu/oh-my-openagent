import { describe, expect, test } from "bun:test"
import { runMigration, type MigrationBoundary } from "../index"
import { MemoryMigrationFileSystem, migrationFixture, parseFile } from "./migration-test-support"

const crashBoundaries: readonly MigrationBoundary[] = [
  "journal-written",
  "target-written",
  "target-recorded",
  "source-moved",
  "source-recorded",
]

describe("runMigration recovery", () => {
  for (const boundary of crashBoundaries) {
    test(`#given a crash after ${boundary} #when the next entrypoint runs #then it resumes before predicate evaluation`, () => {
      // given
      const fileSystem = new MemoryMigrationFileSystem()
      let recoveryTransformCalls = 0
      fileSystem.files.set(migrationFixture.sourcePath, `{}`)

      // when
      const crash = (): void => {
        runMigration({
          env: migrationFixture.env,
          fileSystem,
          id: "crash-safe",
          onBoundary: (current) => {
            if (current === boundary) throw new Error(`Injected crash after ${boundary}`)
          },
          pid: 100,
          sources: [{ path: migrationFixture.sourcePath }],
          targetPath: migrationFixture.targetPath,
          transform: () => ({ task: { default_concurrency: 3 } }),
        })
      }
      expect(crash).toThrow(`Injected crash after ${boundary}`)
      const recovered = runMigration({
        env: migrationFixture.env,
        fileSystem,
        id: "crash-safe",
        pid: 100,
        sources: [{ path: migrationFixture.sourcePath }],
        targetPath: migrationFixture.targetPath,
        transform: () => {
          recoveryTransformCalls += 1
          return { task: { default_concurrency: 3 } }
        },
      })

      // then
      expect(recovered.status).toBe("skipped")
      expect(recovered.journalResumed).toBe(true)
      expect(recoveryTransformCalls).toBe(0)
      expect(parseFile(fileSystem, migrationFixture.targetPath)._migrations).toEqual(["crash-safe"])
      expect(fileSystem.existsSync(migrationFixture.sourcePath)).toBe(false)
      expect(fileSystem.existsSync(`${migrationFixture.sourcePath}.bak.crash-safe`)).toBe(true)
      expect(fileSystem.existsSync("/home/alice/.omo/.migration-journal.json")).toBe(false)
    })
  }
})
