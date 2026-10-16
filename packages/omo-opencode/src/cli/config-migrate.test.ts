import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runConfigMigrate } from "./config-migrate"

const fixtures: string[] = []

function createFixture(): { readonly homeDir: string; readonly root: string; readonly sourcePath: string; readonly targetPath: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-config-migrate-"))
  fixtures.push(root)
  const homeDir = join(root, "home")
  const sourcePath = join(homeDir, ".config", "opencode", "oh-my-openagent.json")
  const targetPath = join(homeDir, ".omo", "omo.jsonc")
  mkdirSync(join(homeDir, ".config", "opencode"), { recursive: true })
  writeFileSync(sourcePath, JSON.stringify({
    agents: { oracle: { model: "anthropic/legacy" } },
    model_fallback: true,
  }))
  return { homeDir, root, sourcePath, targetPath }
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("runConfigMigrate", () => {
  test("#given legacy configuration #when dry run is requested #then it prints the transform and move plan without writing a target", () => {
    // given
    const fixture = createFixture()
    const sourceMtime = statSync(fixture.sourcePath).mtimeMs
    const lines: string[] = []

    // when
    const exitCode = runConfigMigrate({
      cwd: fixture.root,
      dryRun: true,
      environment: { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") },
      output: (line) => lines.push(line),
    })

    // then
    expect(exitCode).toBe(0)
    expect(lines.join("\n")).toContain("transform")
    expect(lines.join("\n")).toContain("move-plan")
    expect(existsSync(fixture.targetPath)).toBe(false)
    expect(statSync(fixture.sourcePath).mtimeMs).toBe(sourceMtime)
  })

  test("#given legacy configuration #when JSON dry run is requested #then the complete plan is machine readable", () => {
    // given
    const fixture = createFixture()
    const lines: string[] = []

    // when
    const exitCode = runConfigMigrate({
      cwd: fixture.root,
      dryRun: true,
      environment: { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") },
      json: true,
      output: (line) => lines.push(line),
    })

    // then
    expect(exitCode).toBe(0)
    const report = JSON.parse(lines.join("\n")) as { migrations: Array<{ readonly movePlan: unknown[]; readonly transform?: unknown }> }
    expect(report.migrations[0]?.transform).toBeDefined()
    expect(report.migrations[0]?.movePlan).toHaveLength(1)
  })

  test("#given a dry run completed first #when non-dry migration runs twice #then the second exits successfully with nothing to migrate", () => {
    // given
    const fixture = createFixture()
    runConfigMigrate({
      cwd: fixture.root,
      dryRun: true,
      environment: { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") },
      output: () => {},
    })
    const firstLines: string[] = []
    const secondLines: string[] = []

    // when
    const firstExitCode = runConfigMigrate({
      cwd: fixture.root,
      environment: { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") },
      output: (line) => firstLines.push(line),
    })
    const secondExitCode = runConfigMigrate({
      cwd: fixture.root,
      environment: { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") },
      output: (line) => secondLines.push(line),
    })

    // then
    expect(firstExitCode).toBe(0)
    expect(readFileSync(fixture.targetPath, "utf-8")).toContain("model_fallback")
    expect(secondExitCode).toBe(0)
    expect(secondLines.join("\n")).toContain("Nothing to migrate")
  })

  test("#given a pending journal #when dry run is requested #then it completes recovery before reporting no new migration", () => {
    // given
    const fixture = createFixture()
    const journalPath = join(fixture.homeDir, ".omo", ".migration-journal.json")
    mkdirSync(join(fixture.homeDir, ".omo"), { recursive: true })
    writeFileSync(journalPath, JSON.stringify({
      backupMoves: [{ from: fixture.sourcePath, to: join(fixture.homeDir, ".omo", "backup.json") }],
      completedMoves: [],
      migrationId: "recovery",
      targetPath: fixture.targetPath,
      targetWrite: { additions: { task: { default_concurrency: 3 } } },
      targetWritten: false,
      version: 1,
    }))
    const lines: string[] = []

    // when
    const exitCode = runConfigMigrate({
      cwd: fixture.root,
      dryRun: true,
      environment: { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") },
      output: (line) => lines.push(line),
    })

    // then
    expect(exitCode).toBe(0)
    expect(existsSync(journalPath)).toBe(false)
    expect(existsSync(join(fixture.homeDir, ".omo", "backup.json"))).toBe(true)
    expect(lines.join("\n")).toContain("Recovered pending migration")
  })
  test("#given a unified config with a user edit and a legacy file #when migrating #then the edit survives, every backup it wrote is named, and a rerun writes nothing (#8187)", () => {
    // given
    const fixture = createFixture()
    mkdirSync(join(fixture.homeDir, ".omo"), { recursive: true })
    writeFileSync(fixture.targetPath, '// my notes\n{"agents":{"oracle":{"model":"anthropic/MINE"}}}\n')
    const environment = { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") }
    const lines: string[] = []

    // when
    const exitCode = runConfigMigrate({ cwd: fixture.root, environment, output: (line) => lines.push(line) })

    // then
    expect(exitCode).toBe(0)
    const migrated = readFileSync(fixture.targetPath, "utf8")
    expect(migrated).toContain("anthropic/MINE")
    expect(migrated).toContain("// my notes")
    const named = lines.flatMap((line) => line.startsWith("backup: ") ? [line.slice("backup: ".length)] : [])
    expect(named.length).toBeGreaterThan(0)
    const onDisk = readdirSync(join(fixture.homeDir, ".omo")).filter((name) => name.startsWith("omo.jsonc.bak."))
    expect(onDisk.map((name) => join(fixture.homeDir, ".omo", name)).sort()).toEqual([...named].sort())
    for (const backup of named) {
      expect(existsSync(backup)).toBe(true)
      expect(readFileSync(backup, "utf8")).toContain("anthropic/MINE")
    }

    // when
    const before = statSync(fixture.targetPath).mtimeMs
    const rerun: string[] = []
    runConfigMigrate({ cwd: fixture.root, environment, output: (line) => rerun.push(line) })

    // then
    expect(rerun).toContain("Nothing to migrate.")
    expect(readFileSync(fixture.targetPath, "utf8")).toBe(migrated)
    expect(statSync(fixture.targetPath).mtimeMs).toBe(before)
  })
  for (const crashedAfterWrite of [false, true]) {
    test(`#given a pending journal for an existing target ${crashedAfterWrite ? "whose write already happened" : "not yet written"} #when recovery runs #then it names the backup it kept (#8187)`, () => {
      // given
      const fixture = createFixture()
      const omoDir = join(fixture.homeDir, ".omo")
      mkdirSync(omoDir, { recursive: true })
      const original = '{"agents":{"oracle":{"model":"anthropic/MINE"}}}\n'
      writeFileSync(fixture.targetPath, original)
      const backupPath = join(omoDir, "omo.jsonc.bak.planned")
      if (crashedAfterWrite) {
        writeFileSync(backupPath, original)
        writeFileSync(fixture.targetPath, '{"agents":{"oracle":{"model":"anthropic/MINE"}},"_migrations":["recovery"]}\n')
      }
      writeFileSync(join(omoDir, ".migration-journal.json"), JSON.stringify({
        backupMoves: [{ from: fixture.sourcePath, to: join(omoDir, "backup.json") }],
        completedMoves: [],
        migrationId: "recovery",
        targetBackupPath: backupPath,
        targetPath: fixture.targetPath,
        targetWrite: { additions: { task: { default_concurrency: 3 } } },
        targetWritten: false,
        version: 1,
      }))
      const lines: string[] = []

      // when
      runConfigMigrate({
        cwd: fixture.root,
        dryRun: true,
        environment: { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") },
        output: (line) => lines.push(line),
      })

      // then
      expect(lines).toContain(`backup: ${backupPath}`)
      expect(readFileSync(backupPath, "utf8")).toBe(original)
      expect(readFileSync(fixture.targetPath, "utf8")).toContain("anthropic/MINE")
    })
  }
  for (const leftover of ["same", "different"] as const) {
    test(`#given a crash after the backup write but before the target write (${leftover} leftover) #when migrate runs twice #then it finishes, names a backup holding the original, and never gets stuck (#8187)`, () => {
      // given
      const fixture = createFixture()
      const omoDir = join(fixture.homeDir, ".omo")
      mkdirSync(omoDir, { recursive: true })
      const original = '{"agents":{"oracle":{"model":"anthropic/MINE"}}}\n'
      writeFileSync(fixture.targetPath, original)
      const backupPath = join(omoDir, "omo.jsonc.bak.planned")
      writeFileSync(backupPath, leftover === "same" ? original : '{"unrelated":true}\n')
      const journalPath = join(omoDir, ".migration-journal.json")
      writeFileSync(journalPath, JSON.stringify({
        backupMoves: [{ from: fixture.sourcePath, to: join(omoDir, "backup.json") }],
        completedMoves: [],
        migrationId: "recovery",
        targetBackupPath: backupPath,
        targetPath: fixture.targetPath,
        targetWrite: { additions: { task: { default_concurrency: 3 } } },
        targetWritten: false,
        version: 1,
      }))
      const environment = { HOME: fixture.homeDir, XDG_CONFIG_HOME: join(fixture.homeDir, ".config") }

      // when
      const lines: string[] = []
      const first = runConfigMigrate({ cwd: fixture.root, environment, output: (line) => lines.push(line) })
      const second = runConfigMigrate({ cwd: fixture.root, environment, output: () => {} })

      // then
      expect(first).toBe(0)
      expect(second).toBe(0)
      expect(existsSync(journalPath)).toBe(false)
      expect(readFileSync(fixture.targetPath, "utf8")).toContain("_migrations")
      const named = lines.flatMap((line) => line.startsWith("backup: ") ? [line.slice("backup: ".length)] : [])
      expect(named.length).toBeGreaterThan(0)
      expect(named.some((path) => readFileSync(path, "utf8") === original)).toBe(true)
      if (leftover === "different") expect(readFileSync(backupPath, "utf8")).toBe('{"unrelated":true}\n')
    })
  }
})
