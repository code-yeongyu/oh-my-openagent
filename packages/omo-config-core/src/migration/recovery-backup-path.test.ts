import { describe, expect, test } from "bun:test"
import { runMigrations } from "./batch"
import { writeOmoMigrationTarget } from "./commit"
import { MemoryMigrationFileSystem, migrationFixture } from "./migration-test-support"

const journalPath = "/home/alice/.omo/.migration-journal.json"
const original = '{"agents":{"oracle":{"model":"anthropic/MINE"}}}\n'

describe("journal recovery names the backup it actually wrote (#8187)", () => {
  test("#given a foreign file at the planned backup name #when recovery crashes after the target write and runs again #then it names the file holding the original", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const planned = `${migrationFixture.targetPath}.bak.planned`
    fileSystem.files.set(migrationFixture.targetPath, original)
    fileSystem.files.set(planned, '{"unrelated":true}\n')
    fileSystem.files.set(journalPath, JSON.stringify({
      backupMoves: [],
      completedMoves: [],
      migrationId: "recovery",
      targetBackupPath: planned,
      targetPath: migrationFixture.targetPath,
      targetWrite: { additions: { task: { default_concurrency: 3 } } },
      targetWritten: false,
      version: 1,
    }))

    // when
    const crash = (): void => {
      runMigrations({
        discover: () => [],
        env: migrationFixture.env,
        fileSystem,
        pid: 100,
        writeTarget: (input) => {
          writeOmoMigrationTarget(input)
          throw new Error("Injected crash after the target write")
        },
      })
    }
    expect(crash).toThrow("Injected crash after the target write")
    const recovered = runMigrations({ discover: () => [], env: migrationFixture.env, fileSystem, pid: 100 })

    // then
    expect(recovered.journalResumed).toBe(true)
    expect(recovered.resumedTargetBackupPath).toBeDefined()
    expect(fileSystem.readFileSync(recovered.resumedTargetBackupPath ?? "", "utf-8")).toBe(original)
    expect(fileSystem.readFileSync(planned, "utf-8")).toBe('{"unrelated":true}\n')
    expect(fileSystem.existsSync(journalPath)).toBe(false)
  })
})
