import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
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
})
