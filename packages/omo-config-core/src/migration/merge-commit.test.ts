import { describe, expect, test } from "bun:test"
import { runMigration } from "../index"
import { MemoryMigrationFileSystem, migrationFixture, parseFile } from "./migration-test-support"

describe("runMigration", () => {
  test("#given a legacy value collides with a target value #when migrating #then the target value wins with a skipped diagnostic", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(migrationFixture.sourcePath, `{"task":{"default_concurrency":3}}`)
    fileSystem.files.set(migrationFixture.targetPath, `{"task":{"default_concurrency":5}}`)

    // when
    const result = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "legacy-task",
      pid: 100,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ task: { default_concurrency: 3 } }),
    })

    // then
    expect(result.status).toBe("migrated")
    expect(result.diagnostics).toEqual(["skipped: task.default_concurrency legacy=3 kept=5"])
    expect(parseFile(fileSystem, migrationFixture.targetPath).task).toEqual({ default_concurrency: 5 })
  })

  test("#given a user target marker #when a project target is discovered later #then the project target migrates independently", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const projectTarget = "/work/project/.omo/omo.jsonc"
    fileSystem.files.set(migrationFixture.sourcePath, `{"task":{"default_concurrency":3}}`)
    fileSystem.files.set(migrationFixture.targetPath, `{"_migrations":["legacy-task"]}`)

    // when
    const result = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "legacy-task",
      pid: 100,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: projectTarget,
      transform: () => ({ task: { default_concurrency: 3 } }),
    })

    // then
    expect(result.status).toBe("migrated")
    expect(parseFile(fileSystem, projectTarget)._migrations).toEqual(["legacy-task"])
    expect(parseFile(fileSystem, migrationFixture.targetPath)._migrations).toEqual(["legacy-task"])
  })

  test("#given distinct migration ids for one target #when each group has a source #then each id runs once without suppressing the other", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const sourceA = "/legacy/a.jsonc"
    const sourceB = "/legacy/b.jsonc"
    let transformCalls = 0
    fileSystem.files.set(sourceA, `{}`)
    fileSystem.files.set(sourceB, `{}`)

    // when
    const first = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "legacy-a",
      pid: 100,
      sources: [{ path: sourceA }],
      targetPath: migrationFixture.targetPath,
      transform: () => {
        transformCalls += 1
        return { task: { default_concurrency: 3 } }
      },
    })
    const second = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "legacy-b",
      pid: 100,
      sources: [{ path: sourceB }],
      targetPath: migrationFixture.targetPath,
      transform: () => {
        transformCalls += 1
        return { task: { wait: { default_ms: 1000 } } }
      },
    })
    fileSystem.files.set(sourceA, `{}`)
    const retry = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "legacy-a",
      pid: 100,
      sources: [{ path: sourceA }],
      targetPath: migrationFixture.targetPath,
      transform: () => {
        transformCalls += 1
        return { task: { default_concurrency: 3 } }
      },
    })

    // then
    expect(first.status).toBe("migrated")
    expect(second.status).toBe("migrated")
    expect(retry.status).toBe("skipped")
    expect(transformCalls).toBe(2)
    expect(parseFile(fileSystem, migrationFixture.targetPath)._migrations).toEqual(["legacy-a", "legacy-b"])
  })

  test("#given a transformed document rejected by OmoConfigSchema #when migrating #then target and sources are untouched", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(migrationFixture.sourcePath, `{}`)
    fileSystem.files.set(migrationFixture.targetPath, `{"task":{"default_concurrency":5}}`)
    const targetBefore = fileSystem.readFileSync(migrationFixture.targetPath, "utf-8")

    // when
    const migrate = (): void => {
      runMigration({
        env: migrationFixture.env,
        fileSystem,
        id: "invalid-config",
        pid: 100,
        sources: [{ path: migrationFixture.sourcePath }],
        targetPath: migrationFixture.targetPath,
        transform: () => ({ unsupported_key: true }),
      })
    }

    // then
    expect(migrate).toThrow("Migration validation failed")
    expect(fileSystem.readFileSync(migrationFixture.targetPath, "utf-8")).toBe(targetBefore)
    expect(fileSystem.existsSync(migrationFixture.sourcePath)).toBe(true)
    expect(fileSystem.existsSync("/home/alice/.omo/.migration-journal.json")).toBe(false)
  })
})
