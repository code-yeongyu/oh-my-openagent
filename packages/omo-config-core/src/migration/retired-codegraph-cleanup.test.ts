import { describe, expect, test } from "bun:test"
import { runMigration } from "../index"
import { canonicalizeLegacyHarnessBlocks } from "../schema/legacy-harness-names"
import { MemoryMigrationFileSystem, migrationFixture, parseFile } from "./migration-test-support"

/** Every harness block the schema accepts (canonical `[opencode]`, `[native]`, `[codex]` plus the legacy `[senpi]` spelling), listed explicitly so a dropped block shows up here. */
const HARNESS_BLOCKS = ["[opencode]", "[native]", "[codex]", "[senpi]"] as const

/** Every location `stripRetiredCodegraph` is expected to clean: root, each harness block, each profile, each profile harness block. */
const RETIRED_CODEGRAPH_TARGET = {
  codegraph: { enabled: true },
  "[opencode]": { codegraph: { enabled: true } },
  "[native]": { codegraph: { enabled: true } },
  "[codex]": { codegraph: { enabled: true } },
  "[senpi]": { codegraph: { enabled: true } },
  profiles: {
    default: {
      codegraph: { enabled: true },
      "[opencode]": { codegraph: { enabled: true } },
      "[native]": { codegraph: { enabled: true } },
      "[codex]": { codegraph: { enabled: true } },
      "[senpi]": { codegraph: { enabled: true } },
    },
  },
}

const RETIRED_CODEGRAPH_DIAGNOSTICS = [
  "removed: codegraph (retired configuration)",
  "removed: [opencode].codegraph (retired configuration)",
  "removed: [native].codegraph (retired configuration)",
  "removed: [codex].codegraph (retired configuration)",
  "removed: [senpi].codegraph (retired configuration)",
  "removed: profiles.default.codegraph (retired configuration)",
  "removed: profiles.default.[opencode].codegraph (retired configuration)",
  "removed: profiles.default.[native].codegraph (retired configuration)",
  "removed: profiles.default.[codex].codegraph (retired configuration)",
  "removed: profiles.default.[senpi].codegraph (retired configuration)",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function expectSection(document: Record<string, unknown>, key: string): Record<string, unknown> {
  const section = document[key]
  if (!isRecord(section)) throw new Error(`expected ${key} to survive the migration as an object, got ${JSON.stringify(section)}`)
  return section
}

/** Asserts each section still exists (the migration must strip codegraph, not the whole block) and no longer carries codegraph. */
function expectCodegraphStrippedFromEverySection(target: Record<string, unknown>): void {
  for (const harness of HARNESS_BLOCKS) {
    expect(expectSection(target, harness)).not.toHaveProperty("codegraph")
  }
  const profile = expectSection(expectSection(target, "profiles"), "default")
  expect(profile).not.toHaveProperty("codegraph")
  for (const harness of HARNESS_BLOCKS) {
    expect(expectSection(profile, harness)).not.toHaveProperty("codegraph")
  }
}

describe("runMigration retired codegraph cleanup", () => {
  test("#given a target with retired codegraph settings #when merging a migration #then every retired location is removed before validation", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(migrationFixture.sourcePath, `{}`)
    fileSystem.files.set(migrationFixture.targetPath, JSON.stringify(RETIRED_CODEGRAPH_TARGET))

    // when
    const result = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "legacy-codegraph",
      pid: 100,
      sources: [{ path: migrationFixture.sourcePath }],
      targetPath: migrationFixture.targetPath,
      transform: () => ({ task: { default_concurrency: 3 } }),
    })

    // then
    expect(result.status).toBe("migrated")
    expect(result.diagnostics).toEqual(RETIRED_CODEGRAPH_DIAGNOSTICS)
    const target = parseFile(fileSystem, migrationFixture.targetPath)
    expect(target).toMatchObject({
      task: { default_concurrency: 3 },
      _migrations: ["legacy-codegraph"],
    })
    expect(target).not.toHaveProperty("codegraph")
    expectCodegraphStrippedFromEverySection(target)
  })

  test("#given a target with retired codegraph settings #when replacing the target #then every retired location is removed before validation", () => {
    // given
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(migrationFixture.targetPath, JSON.stringify(RETIRED_CODEGRAPH_TARGET))

    // when
    const result = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "retire-codegraph",
      mode: "replace-target",
      pid: 100,
      sources: [],
      targetPath: migrationFixture.targetPath,
      transform: (loaded) => {
        const [current] = loaded
        if (current === undefined || !isRecord(current.value)) throw new Error("replace-target transform received no target document")
        return { ...current.value, task: { default_concurrency: 4 } }
      },
    })

    // then
    expect(result.status).toBe("migrated")
    // the transform passed the target through, so target and document cleanup see the same paths: each is reported once
    expect(result.diagnostics).toEqual(RETIRED_CODEGRAPH_DIAGNOSTICS)
    const target = parseFile(fileSystem, migrationFixture.targetPath)
    expect(target).toMatchObject({
      task: { default_concurrency: 4 },
      _migrations: ["retire-codegraph"],
    })
    expect(target).not.toHaveProperty("codegraph")
    expectCodegraphStrippedFromEverySection(target)
  })

  test("#given [senpi].codegraph and a replace-target transform that renames [senpi] to [native] #when migrating #then the retired key is stripped from the renamed block too", () => {
    // given: a beta.80 user whose earlier merge migrations already ran, so the harness rename is the first migration to touch the file
    const fileSystem = new MemoryMigrationFileSystem()
    fileSystem.files.set(
      migrationFixture.targetPath,
      JSON.stringify({ "[senpi]": { codegraph: { enabled: true } }, profiles: { default: { "[senpi]": { codegraph: { enabled: true } } } }, _migrations: ["earlier-merge"] }),
    )

    // when
    const result = runMigration({
      env: migrationFixture.env,
      fileSystem,
      id: "harness-native-rename",
      mode: "replace-target",
      pid: 100,
      sources: [],
      targetPath: migrationFixture.targetPath,
      transform: (loaded) => canonicalizeLegacyHarnessBlocks(loaded[0]?.value).document,
    })

    // then
    expect(result.status).toBe("migrated")
    expect(result.diagnostics).toEqual([
      "removed: [senpi].codegraph (retired configuration)",
      "removed: profiles.default.[senpi].codegraph (retired configuration)",
      "removed: [native].codegraph (retired configuration)",
      "removed: profiles.default.[native].codegraph (retired configuration)",
    ])
    const target = parseFile(fileSystem, migrationFixture.targetPath)
    expect(target).toEqual({ "[native]": {}, profiles: { default: { "[native]": {} } }, _migrations: ["earlier-merge", "harness-native-rename"] })
  })
})
