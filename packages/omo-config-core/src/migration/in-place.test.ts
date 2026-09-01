import { describe, expect, test } from "bun:test"

import { runMigration } from "./engine"
import { MemoryMigrationFileSystem, migrationFixture, parseFile } from "./migration-test-support"

describe("runMigration replace-target mode", () => {
  test("#given a crash after journaling an in-place rewrite #when migration resumes #then deletions, additions, and the marker are replayed exactly", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(migrationFixture.targetPath, JSON.stringify({ categories: { deep: { variant: "high" } } }))
    const options = {
      env: migrationFixture.env,
      fileSystem,
      id: "replace-target-test",
      mode: "replace-target" as const,
      sources: [],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ categories: { deep: { reasoning: "high" } } }),
    }

    // when
    expect(() => runMigration({
      ...options,
      onBoundary: (boundary) => {
        if (boundary === "journal-written") throw new Error("crash")
      },
    })).toThrow("crash")
    const resumed = runMigration(options)

    // then
    expect(resumed.journalResumed).toBe(true)
    expect(parseFile(fileSystem, migrationFixture.targetPath)).toEqual({
      categories: { deep: { reasoning: "high" } },
      _migrations: ["replace-target-test"],
    })
  })
})
