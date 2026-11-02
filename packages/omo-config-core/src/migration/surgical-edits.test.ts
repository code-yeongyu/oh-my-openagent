import { describe, expect, test } from "bun:test"

import { runMigration } from "./engine"
import { MemoryMigrationFileSystem, migrationFixture } from "./migration-test-support"

const COMMENTED_FIXTURE = `// line comment at top
{
    "disabled_skills": [
        "playwright", // why: I use my own
        "frontend",
    ],
    "agents": {
        /* nested block comment */
        "oracle": { "model": "anthropic/claude-opus-5-5" },   // inline trailing comment
        "librarian":	{ "model": "zai/glm-5.3" },
    },
}
`

function readTarget(fileSystem: MemoryMigrationFileSystem): string {
  const written = fileSystem.files.get(migrationFixture.targetPath)
  if (written === undefined) throw new Error("migration wrote no target")
  return written
}

function replaceTarget(content: string, transform: (current: Record<string, unknown>) => Record<string, unknown>): string {
  const fileSystem = new MemoryMigrationFileSystem()
  fileSystem.files.set(migrationFixture.targetPath, content)
  const result = runMigration({
    env: migrationFixture.env,
    fileSystem,
    id: "surgical-test",
    mode: "replace-target",
    sources: [],
    targetPath: migrationFixture.targetPath,
    transform: ([target]) => transform(structuredClone((target?.value ?? {}) as Record<string, unknown>)),
  })
  expect(result.status).toBe("migrated")
  return readTarget(fileSystem)
}

function mergeLegacy(content: string, legacy: Record<string, unknown>): string {
  const fileSystem = new MemoryMigrationFileSystem()
  fileSystem.files.set(migrationFixture.targetPath, content)
  fileSystem.files.set(migrationFixture.sourcePath, JSON.stringify(legacy))
  const result = runMigration({
    env: migrationFixture.env,
    fileSystem,
    id: "surgical-test",
    sources: [{ path: migrationFixture.sourcePath }],
    targetPath: migrationFixture.targetPath,
    transform: ([source]) => (source?.value ?? {}) as Record<string, unknown>,
  })
  expect(result.status).toBe("migrated")
  return readTarget(fileSystem)
}

function expectOriginalLinesKept(original: string, migrated: string): void {
  const kept = migrated.split("\n")
  let cursor = 0
  for (const line of original.split("\n")) {
    const at = kept.indexOf(line, cursor)
    expect({ missing: at === -1 ? line : undefined }).toEqual({ missing: undefined })
    cursor = at + 1
  }
}

describe("replace-target migrations edit only what changes (#9777)", () => {
  test("#given a commented, trailing-comma, 4-space omo.jsonc #when a replace-target transform changes nothing #then only the marker is added", () => {
    // when
    const migrated = replaceTarget(COMMENTED_FIXTURE, (current) => current)

    // then
    expectOriginalLinesKept(COMMENTED_FIXTURE, migrated)
    expect(migrated).toContain('"_migrations"')
  })

  test("#given the same file #when the transform changes one nested value #then only that value's text changes", () => {
    // when
    const migrated = replaceTarget(COMMENTED_FIXTURE, (current) => {
      const agents = current["agents"] as Record<string, Record<string, unknown>>
      agents["oracle"] = { model: "anthropic/claude-opus-5-5", reasoning: "high" }
      return current
    })

    // then
    expectOriginalLinesKept(
      COMMENTED_FIXTURE.replace('        "oracle": { "model": "anthropic/claude-opus-5-5" },   // inline trailing comment\n', ""),
      migrated,
    )
    expect(migrated).toContain('"reasoning": "high"')
    expect(migrated).toContain("// inline trailing comment")
  })

  test("#given the same file #when the transform drops one nested key #then only that member is removed", () => {
    // when
    const migrated = replaceTarget(COMMENTED_FIXTURE, (current) => {
      const agents = current["agents"] as Record<string, unknown>
      delete agents["librarian"]
      return current
    })

    // then
    expectOriginalLinesKept(
      COMMENTED_FIXTURE.replace('        "librarian":\t{ "model": "zai/glm-5.3" },\n', ""),
      migrated,
    )
    expect(migrated).not.toContain("librarian")
  })

  test("#given the same file #when a merge migration adds one nested key #then every original line is kept", () => {
    // when
    const migrated = mergeLegacy(COMMENTED_FIXTURE, { agents: { explore: { model: "zai/glm-5.3" } } })

    // then
    expectOriginalLinesKept(COMMENTED_FIXTURE, migrated)
    expect(migrated).toContain('"explore"')
  })
})
