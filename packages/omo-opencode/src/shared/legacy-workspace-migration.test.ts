import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

  test("#given legacy workspace contains symlinks #when migrating #then skips symlinks without copying target contents", () => {
    // given
    const externalFilePath = join(testDirectory, "external-secret.md")
    const legacyLinkPath = join(testDirectory, ".sisyphus", "plans", "linked.md")
    mkdirSync(join(testDirectory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(externalFilePath, "secret", "utf-8")
    symlinkSync(externalFilePath, legacyLinkPath)

    // when
    const result = migrateLegacyWorkspaceDirectory(testDirectory)

    // then
    expect(result.migrated).toBe(false)
    expect(result.skipped).toContain(join(".omo", "plans", "linked.md"))
    expect(existsSync(join(testDirectory, ".omo", "plans", "linked.md"))).toBe(false)
  })

  test("#given the directory is the user's home #when migrating #then leaves the home ~/.omo untouched", () => {
    // given: OpenCode started in $HOME, where ~/.omo is the OmO home (agent dir, memory, the desktop app's
    // live database under ~/.omo/desktop), not a project workspace (#9727)
    const previousHome = process.env.HOME
    process.env.HOME = testDirectory
    mkdirSync(join(testDirectory, ".sisyphus", "desktop"), { recursive: true })
    mkdirSync(join(testDirectory, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(join(testDirectory, ".sisyphus", "desktop", "state.sqlite-wal"), "foreign", "utf-8")
    writeFileSync(join(testDirectory, ".sisyphus", "plans", "work.md"), "# Plan", "utf-8")
    mkdirSync(join(testDirectory, ".omo", "desktop"), { recursive: true })
    writeFileSync(join(testDirectory, ".omo", "desktop", "state.sqlite"), "live", "utf-8")

    try {
      // when
      const result = migrateLegacyWorkspaceDirectory(testDirectory)

      // then
      expect(result.migrated).toBe(false)
      expect(readdirSync(join(testDirectory, ".omo")).sort()).toEqual(["desktop"])
      expect(readdirSync(join(testDirectory, ".omo", "desktop"))).toEqual(["state.sqlite"])
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  test("#given a dangling symlink at the target path #when migrating #then never writes through it", () => {
    // given: a target entry that exists as a link to a path outside .omo, but whose destination is missing
    const outsidePath = join(testDirectory, "outside", "work.md")
    mkdirSync(join(testDirectory, "outside"), { recursive: true })
    mkdirSync(join(testDirectory, ".sisyphus", "plans"), { recursive: true })
    mkdirSync(join(testDirectory, ".omo", "plans"), { recursive: true })
    writeFileSync(join(testDirectory, ".sisyphus", "plans", "work.md"), "legacy", "utf-8")
    symlinkSync(outsidePath, join(testDirectory, ".omo", "plans", "work.md"))

    // when
    const result = migrateLegacyWorkspaceDirectory(testDirectory)

    // then
    expect(existsSync(outsidePath)).toBe(false)
    expect(result.skipped).toContain(join(".omo", "plans", "work.md"))
  })

  test("#given no legacy workspace #when migrating #then reports no migration", () => {
    // when
    const result = migrateLegacyWorkspaceDirectory(testDirectory)

    // then
    expect(result).toEqual({ migrated: false, skipped: [] })
  })
})
