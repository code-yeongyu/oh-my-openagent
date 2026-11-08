import { describe, expect, test } from "bun:test"

import { runMigrations } from "./batch"
import { MemoryMigrationFileSystem, migrationFixture, parseFile } from "./migration-test-support"

function plan(shouldRun: (target: Readonly<Record<string, unknown>>) => boolean) {
  return {
    id: "content-gated-test",
    mode: "replace-target" as const,
    shouldRun,
    sources: [],
    targetPath: migrationFixture.targetPath,
    transform: () => ({ categories: { "deep-low": { reasoning: "high" } } }),
  }
}

describe("MigrationPlan.shouldRun", () => {
  test("#given a target the plan has nothing to do to #when the batch runs #then the file is byte-identical and carries no marker", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    const original = JSON.stringify({ categories: { quick: { reasoning: "low" } } })
    fileSystem.files.set(migrationFixture.targetPath, original)

    // when
    const batch = runMigrations({
      env: migrationFixture.env,
      fileSystem,
      discover: () => [plan(() => false)],
    })

    // then
    expect(batch.results.map(({ status }) => status)).toEqual(["skipped"])
    expect(fileSystem.readFileSync(migrationFixture.targetPath, "utf-8")).toBe(original)
    expect(parseFile(fileSystem, migrationFixture.targetPath)["_migrations"]).toBeUndefined()
    expect(fileSystem.operations.filter((operation) => operation.startsWith("write:") || operation.startsWith("rename:"))).toEqual([])
  })

  test("#given a target the plan does have work for #when the batch runs #then it is rewritten and marked once", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(migrationFixture.targetPath, JSON.stringify({ categories: { deep: { reasoning: "high" } } }))

    // when
    const batch = runMigrations({
      env: migrationFixture.env,
      fileSystem,
      discover: () => [plan(() => true)],
    })

    // then
    expect(batch.results.map(({ status }) => status)).toEqual(["migrated"])
    expect(parseFile(fileSystem, migrationFixture.targetPath)).toEqual({
      categories: { "deep-low": { reasoning: "high" } },
      _migrations: ["content-gated-test"],
    })
  })

  test("#given the gate reads the current target #when the batch runs #then it receives the parsed document", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(migrationFixture.targetPath, JSON.stringify({ categories: { deep: {} } }))
    const seen: Record<string, unknown>[] = []

    // when
    runMigrations({
      env: migrationFixture.env,
      fileSystem,
      discover: () => [plan((target) => {
        seen.push(target)
        return false
      })],
    })

    // then
    expect(seen).toEqual([{ categories: { deep: {} } }])
  })
})
