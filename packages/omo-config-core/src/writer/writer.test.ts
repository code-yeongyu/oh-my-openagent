import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, setSystemTime, test } from "bun:test"
import { loadOmoConfig, OmoConfigWriteError, updateOmoConfig } from "../index"

function makeFixture(): {
  readonly homeDir: string
  readonly projectDir: string
  readonly xdgConfigHome: string
} {
  const root = mkdtempSync(join(tmpdir(), "omo-config-writer-"))
  const homeDir = join(root, "home")
  const projectDir = join(homeDir, "project")
  const xdgConfigHome = join(root, "xdg")
  mkdirSync(projectDir, { recursive: true })
  return { homeDir, projectDir, xdgConfigHome }
}

describe("updateOmoConfig", () => {
  test("#given commented project config #when editing twice #then comments survive backup is created and second write sees first content", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.jsonc")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(
      configPath,
      `{
  // task settings stay documented
  "task": {
    "default_concurrency": 5
  }
}
`,
    )

    // when
    const first = updateOmoConfig({
      scope: "project",
      projectDir: fixture.projectDir,
      edits: [{ path: ["task", "default_concurrency"], value: 3 }],
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })
    const second = updateOmoConfig({
      scope: "project",
      projectDir: fixture.projectDir,
      edits: [{ path: ["task", "wait", "default_ms"], value: 12000 }],
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    const content = readFileSync(configPath, "utf-8")
    const backupFiles = readdirSync(join(configPath, "..")).filter((entry: string) => entry.includes(".bak."))
    expect(first.path).toBe(configPath)
    expect(second.path).toBe(configPath)
    expect(content).toContain("// task settings stay documented")
    expect(content).toContain(`"default_concurrency": 3`)
    expect(content).toContain(`"default_ms": 12000`)
    expect(backupFiles).toHaveLength(2)
    expect(backupFiles[0]).toMatch(/omo\.jsonc\.bak\.\d{4}-\d{2}-\d{2}T/)
  })

  test("#given fixed backup timestamp #when editing existing config twice immediately #then backup paths stay distinct", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.jsonc")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(
      configPath,
      `{
  // task settings stay documented
  "task": {
    "default_concurrency": 5
  }
}
`,
    )

    // when
    setSystemTime(new Date("2026-07-06T00:00:00.000Z"))
    try {
      const first = updateOmoConfig({
        scope: "project",
        projectDir: fixture.projectDir,
        edits: [{ path: ["task", "default_concurrency"], value: 3 }],
        env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
        platform: "linux",
      })
      const second = updateOmoConfig({
        scope: "project",
        projectDir: fixture.projectDir,
        edits: [{ path: ["task", "wait", "default_ms"], value: 12000 }],
        env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
        platform: "linux",
      })

      // then
      const content = readFileSync(configPath, "utf-8")
      const backupFiles = readdirSync(join(configPath, "..")).filter((entry: string) => entry.includes(".bak."))
      expect(first.backupPath).toBe(`${configPath}.bak.2026-07-06T00-00-00-000Z`)
      expect(second.backupPath).toStartWith(`${configPath}.bak.2026-07-06T00-00-00-000Z`)
      expect(second.backupPath).not.toBe(first.backupPath)
      expect(existsSync(first.backupPath ?? "")).toBe(true)
      expect(existsSync(second.backupPath ?? "")).toBe(true)
      expect(backupFiles).toHaveLength(2)
      expect(content).toContain("// task settings stay documented")
      expect(content).toContain(`"default_concurrency": 3`)
      expect(content).toContain(`"default_ms": 12000`)
    } finally {
      setSystemTime()
    }
  })

  test("#given missing user config #when editing #then file is created with header and parsed value", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.xdgConfigHome, "omo", "omo.jsonc")

    // when
    const result = updateOmoConfig({
      scope: "user",
      edits: [{ path: ["task", "default_concurrency"], value: 6 }],
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    const content = readFileSync(configPath, "utf-8")
    expect(result.path).toBe(configPath)
    expect(content).toContain("// OMO configuration")
    expect(content).toContain(`"default_concurrency": 6`)
  })

  test("#given existing project omo json #when editing #then writer preserves json path and loaded settings", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.json")
    const shadowPath = join(fixture.projectDir, ".omo", "omo.jsonc")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(configPath, `{"task":{"default_concurrency":9,"wait":{"max_ms":70000}}}\n`)

    // when
    const result = updateOmoConfig({
      scope: "project",
      projectDir: fixture.projectDir,
      edits: [{ path: ["task", "wait", "default_ms"], value: 12000 }],
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })
    const loaded = loadOmoConfig({
      cwd: fixture.projectDir,
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    expect(result.path).toBe(configPath)
    expect(existsSync(shadowPath)).toBe(false)
    expect(loaded.config.task?.default_concurrency).toBe(9)
    expect(loaded.config.task?.wait.default_ms).toBe(12000)
    expect(loaded.config.task?.wait.max_ms).toBe(70000)
  })

  test("#given existing user omo json #when editing #then writer preserves json path and loaded settings", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.xdgConfigHome, "omo", "omo.json")
    const shadowPath = join(fixture.xdgConfigHome, "omo", "omo.jsonc")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(configPath, `{"task":{"default_concurrency":9,"wait":{"max_ms":70000}}}\n`)

    // when
    const result = updateOmoConfig({
      scope: "user",
      edits: [{ path: ["task", "wait", "default_ms"], value: 12000 }],
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })
    const loaded = loadOmoConfig({
      cwd: fixture.projectDir,
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    expect(result.path).toBe(configPath)
    expect(existsSync(shadowPath)).toBe(false)
    expect(loaded.config.task?.default_concurrency).toBe(9)
    expect(loaded.config.task?.wait.default_ms).toBe(12000)
    expect(loaded.config.task?.wait.max_ms).toBe(70000)
  })

  test("#given writer cannot create temp file #when editing #then typed error surfaces and no partial remains", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.jsonc")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(configPath, `{"task":{"default_concurrency":5}}\n`)

    // when
    const run = (): void => {
      updateOmoConfig({
        scope: "project",
        projectDir: fixture.projectDir,
        edits: [{ path: ["task", "default_concurrency"], value: 4 }],
        env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
        fileSystem: {
          copyFileSync: () => undefined,
          existsSync,
          lstatSync,
          mkdirSync,
          readFileSync,
          readdirSync,
          renameSync: () => undefined,
          unlinkSync: () => undefined,
          writeFileExclusiveSync: () => {
            throw new Error("EACCES synthetic")
          },
          writeFileSync,
        },
        platform: "linux",
      })
    }

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
    expect(readFileSync(configPath, "utf-8")).toContain(`"default_concurrency":5`)
  })

  test("#given malformed existing project config #when editing #then typed error surfaces and original bytes remain", () => {
    // given
    const fixture = makeFixture()
    const configPath = join(fixture.projectDir, ".omo", "omo.jsonc")
    const original = `{"task":`
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(configPath, original)

    // when
    const run = (): void => {
      updateOmoConfig({
        scope: "project",
        projectDir: fixture.projectDir,
        edits: [{ path: ["task", "default_concurrency"], value: 4 }],
        env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
        platform: "linux",
      })
    }

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(readFileSync(configPath, "utf-8")).toBe(original)
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
  })
})
