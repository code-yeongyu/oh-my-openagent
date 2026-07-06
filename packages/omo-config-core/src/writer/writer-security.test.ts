import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { OmoConfigWriteError, updateOmoConfig } from "../index"

function makeFixture(): {
  readonly homeDir: string
  readonly projectDir: string
  readonly xdgConfigHome: string
} {
  const root = mkdtempSync(join(tmpdir(), "omo-config-writer-security-"))
  const homeDir = join(root, "home")
  const projectDir = join(homeDir, "project")
  const xdgConfigHome = join(root, "xdg")
  mkdirSync(projectDir, { recursive: true })
  return { homeDir, projectDir, xdgConfigHome }
}

function updateProjectConfig(fixture: ReturnType<typeof makeFixture>): void {
  updateOmoConfig({
    scope: "project",
    projectDir: fixture.projectDir,
    edits: [{ path: ["task", "default_concurrency"], value: 4 }],
    env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
    platform: "linux",
  })
}

describe("updateOmoConfig filesystem safety", () => {
  test("#given preexisting temp symlink #when editing project config #then victim remains unchanged", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.jsonc")
    const victimPath = join(fixture.projectDir, "victim.txt")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(configPath, `{"task":{"default_concurrency":5}}\n`)
    writeFileSync(victimPath, "victim-original")
    symlinkSync(victimPath, `${configPath}.tmp`)

    // when
    updateProjectConfig(fixture)

    // then
    expect(readFileSync(victimPath, "utf-8")).toBe("victim-original")
    expect(readFileSync(configPath, "utf-8")).toContain(`"default_concurrency":4`)
    expect(existsSync(`${configPath}.tmp`)).toBe(true)
  })

  test("#given symlinked existing project jsonc #when editing #then target is rejected and backup does not copy victim", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.jsonc")
    const victimPath = join(fixture.projectDir, "victim.json")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(victimPath, `{"task":{"default_concurrency":8}}\n`)
    symlinkSync(victimPath, configPath)

    // when
    const run = (): void => updateProjectConfig(fixture)

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(readFileSync(victimPath, "utf-8")).toBe(`{"task":{"default_concurrency":8}}\n`)
    const backupFiles = readdirSync(join(configPath, "..")).filter((entry) => entry.includes(".bak."))
    expect(backupFiles).toEqual([])
  })

  test("#given symlinked existing project json #when editing #then target is rejected and backup does not copy victim", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.json")
    const victimPath = join(fixture.projectDir, "victim.json")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(victimPath, `{"task":{"default_concurrency":8}}\n`)
    symlinkSync(victimPath, configPath)

    // when
    const run = (): void => updateProjectConfig(fixture)

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(readFileSync(victimPath, "utf-8")).toBe(`{"task":{"default_concurrency":8}}\n`)
    const backupFiles = readdirSync(join(configPath, "..")).filter((entry) => entry.includes(".bak."))
    expect(backupFiles).toEqual([])
  })

  test("#given symlinked project omo directory #when editing project config #then global target is rejected without backup", () => {
    // given
    const fixture = makeFixture()
    const targetConfigDir = join(fixture.xdgConfigHome, "omo")
    const targetConfigPath = join(targetConfigDir, "omo.jsonc")
    const original = `{"task":{"default_concurrency":8}}\n`
    mkdirSync(targetConfigDir, { recursive: true })
    writeFileSync(targetConfigPath, original)
    symlinkSync(targetConfigDir, join(fixture.projectDir, ".omo"))

    // when
    const run = (): void => updateProjectConfig(fixture)

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(readFileSync(targetConfigPath, "utf-8")).toBe(original)
    const backupFiles = readdirSync(targetConfigDir).filter((entry) => entry.includes(".bak."))
    expect(backupFiles).toEqual([])
  })
})
