import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrateLegacyWorkspaceDirectory } from "./legacy-workspace-migration"

describe("migrateLegacyWorkspaceDirectory", () => {
  let testDirectory = ""

  beforeEach(() => {
    testDirectory = join(tmpdir(), `omo-workspace-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDirectory, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true })
  })

  test("#given legacy workspace with nested state and no target #when migrating #then copies the tree to .omo", () => {
    // given
    const legacyPlanPath = join(testDirectory, ".sisyphus", "plans", "work.md")
    const legacyNotepadDirectory = join(testDirectory, ".sisyphus", "notepads", "work")
    const legacyNotepadPath = join(legacyNotepadDirectory, "notes.md")
    mkdirSync(legacyNotepadDirectory, { recursive: true })
    mkdirSync(join(testDirectory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(legacyPlanPath, "# Plan", "utf-8")
    writeFileSync(legacyNotepadPath, "note", "utf-8")

    // when
    const result = migrateLegacyWorkspaceDirectory(testDirectory)

    // then
    expect(result.migrated).toBe(true)
    expect(readFileSync(join(testDirectory, ".omo", "plans", "work.md"), "utf-8")).toBe("# Plan")
    expect(readFileSync(join(testDirectory, ".omo", "notepads", "work", "notes.md"), "utf-8")).toBe("note")
    expect(existsSync(join(testDirectory, ".sisyphus", "plans", "work.md"))).toBe(true)
  })

  test("#given target file already exists #when migrating #then keeps the target content", () => {
    // given
    const legacyPlanPath = join(testDirectory, ".sisyphus", "plans", "work.md")
    const targetPlanPath = join(testDirectory, ".omo", "plans", "work.md")
    mkdirSync(join(testDirectory, ".sisyphus", "plans"), { recursive: true })
    mkdirSync(join(testDirectory, ".omo", "plans"), { recursive: true })
    writeFileSync(legacyPlanPath, "legacy", "utf-8")
    writeFileSync(targetPlanPath, "target", "utf-8")

    // when
    const result = migrateLegacyWorkspaceDirectory(testDirectory)

    // then
    expect(result.migrated).toBe(false)
    expect(result.skipped).toContain(join(".omo", "plans", "work.md"))
    expect(readFileSync(targetPlanPath, "utf-8")).toBe("target")
  })

  test("#given target has other files #when migrating #then copies only missing legacy files", () => {
    // given
    const legacyPlanPath = join(testDirectory, ".sisyphus", "plans", "work.md")
    const targetNotepadPath = join(testDirectory, ".omo", "notepads", "work", "notes.md")
    mkdirSync(join(testDirectory, ".sisyphus", "plans"), { recursive: true })
    mkdirSync(join(testDirectory, ".omo", "notepads", "work"), { recursive: true })
    writeFileSync(legacyPlanPath, "legacy plan", "utf-8")
    writeFileSync(targetNotepadPath, "existing note", "utf-8")

    // when
    const result = migrateLegacyWorkspaceDirectory(testDirectory)

    // then
    expect(result.migrated).toBe(true)
    expect(readFileSync(join(testDirectory, ".omo", "plans", "work.md"), "utf-8")).toBe("legacy plan")
    expect(readFileSync(targetNotepadPath, "utf-8")).toBe("existing note")
  })

  test("#given no legacy workspace #when migrating #then reports no migration", () => {
    // when
    const result = migrateLegacyWorkspaceDirectory(testDirectory)

    // then
    expect(result).toEqual({ migrated: false, skipped: [] })
  })
})
