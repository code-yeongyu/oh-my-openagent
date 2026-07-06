import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { OmoConfigWriteError, updateOmoConfig } from "../index"

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
          mkdirSync,
          readFileSync,
          readdirSync,
          renameSync: () => undefined,
          unlinkSync: () => undefined,
          writeFileSync: (path: string) => {
            if (String(path).endsWith(".tmp")) throw new Error("EACCES synthetic")
          },
        },
        platform: "linux",
      })
    }

    // then
    expect(run).toThrow(OmoConfigWriteError)
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
    expect(readFileSync(configPath, "utf-8")).toContain(`"default_concurrency":5`)
  })
})
