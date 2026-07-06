import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { loadOmoConfig } from "../index"

function writeJsonc(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function makeFixture(): {
  readonly homeDir: string
  readonly workDir: string
  readonly projectDir: string
  readonly cwd: string
  readonly xdgConfigHome: string
} {
  const root = mkdtempSync(join(tmpdir(), "omo-config-loader-"))
  const homeDir = join(root, "home")
  const xdgConfigHome = join(root, "xdg")
  const workDir = join(homeDir, "work")
  const projectDir = join(workDir, "project")
  const cwd = join(projectDir, "child")
  mkdirSync(cwd, { recursive: true })
  return { homeDir, workDir, projectDir, cwd, xdgConfigHome }
}

describe("loadOmoConfig", () => {
  test("#given user and walked project omo configs #when loading #then nearest project wins and keyed sections deep-merge", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.xdgConfigHome, "omo", "omo.jsonc"),
      `{
        "categories": {
          "quick": { "model": "user-model", "tools": { "read": true } }
        },
        "agents": {
          "reviewer": { "model": "user-agent", "tools": { "bash": false } }
        },
        "task": { "default_concurrency": 2, "wait": { "default_ms": 11000 } },
        "teams": {
          "alpha": {
            "members": [{ "name": "one", "kind": "category", "category": "quick", "prompt": "go" }]
          }
        }
      }`,
    )
    writeJsonc(
      join(fixture.workDir, ".omo", "omo.jsonc"),
      `{
        "categories": {
          "quick": { "model": "far-model", "tools": { "bash": true } },
          "deep": { "model": "deep-model" }
        },
        "agents": { "reviewer": { "temperature": 0.3 } },
        "task": { "default_concurrency": 4, "wait": { "max_ms": 90000 } }
      }`,
    )
    writeJsonc(
      join(fixture.projectDir, ".omo", "omo.jsonc"),
      `{
        "categories": { "quick": { "model": "near-model" } },
        "agents": { "reviewer": { "model": "near-agent" } },
        "task": { "default_concurrency": 7 }
      }`,
    )
    writeJsonc(join(fixture.projectDir, ".omo", "oh-my-openagent.jsonc"), `{"task":{"default_concurrency":99}}`)
    writeJsonc(join(fixture.projectDir, ".omo", "oh-my-opencode.jsonc"), `{"task":{"default_concurrency":98}}`)

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.task?.default_concurrency).toBe(7)
    expect(result.config.task?.wait.default_ms).toBe(11000)
    expect(result.config.task?.wait.max_ms).toBe(90000)
    expect(result.config.categories?.quick?.model).toBe("near-model")
    expect(result.config.categories?.quick?.tools).toEqual({ read: true, bash: true })
    expect(result.config.categories?.deep?.model).toBe("deep-model")
    expect(result.config.agents?.reviewer?.model).toBe("near-agent")
    expect(result.config.agents?.reviewer?.temperature).toBe(0.3)
    expect(result.config.teams?.alpha?.members[0]?.name).toBe("one")
    expect("polluted" in Object.prototype).toBe(false)
  })

  test("#given same-key partial team layers #when loading #then final team merges members and description", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.xdgConfigHome, "omo", "omo.jsonc"),
      `{
        "teams": {
          "alpha": {
            "members": [{ "name": "one", "kind": "category", "category": "quick", "prompt": "go" }]
          }
        }
      }`,
    )
    writeJsonc(
      join(fixture.projectDir, ".omo", "omo.jsonc"),
      `{
        "teams": {
          "alpha": {
            "description": "near layer description"
          }
        }
      }`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.teams?.alpha?.description).toBe("near layer description")
    expect(result.config.teams?.alpha?.members[0]?.name).toBe("one")
  })

  test("#given malformed and unreadable configs #when loading #then defaults survive and typed diagnostics identify paths", () => {
    // given
    const fixture = makeFixture()
    const unreadablePath = join(fixture.projectDir, ".omo", "omo.jsonc")
    writeJsonc(join(fixture.xdgConfigHome, "omo", "omo.jsonc"), `{"task":{"default_concurrency":"five"}}`)
    writeJsonc(unreadablePath, `{"task":{"default_concurrency":3}}`)

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
      fileSystem: {
        existsSync: () => true,
        readFileSync: (path: string) => {
          if (path === unreadablePath) throw new Error("EACCES synthetic")
          return `{"task":{"default_concurrency":"five"}}`
        },
      },
      platform: "linux",
    })

    // then
    expect(result.config.task?.default_concurrency).toBe(5)
    expect(result.diagnostics.map((diagnostic: { readonly kind: string }) => diagnostic.kind)).toContain("validation")
    expect(result.diagnostics.map((diagnostic: { readonly kind: string }) => diagnostic.kind)).toContain("read")
    expect(result.diagnostics.some((diagnostic: { readonly path: string }) => diagnostic.path === unreadablePath)).toBe(true)
  })

  test("#given only user omo json #when loading #then user json is read and jsonc takes precedence when both exist", () => {
    // given
    const jsonOnlyFixture = makeFixture()
    const jsonOnlyPath = join(jsonOnlyFixture.xdgConfigHome, "omo", "omo.json")
    writeJsonc(jsonOnlyPath, `{"task":{"default_concurrency":9}}`)

    // when
    const jsonOnly = loadOmoConfig({
      cwd: jsonOnlyFixture.cwd,
      env: { HOME: jsonOnlyFixture.homeDir, XDG_CONFIG_HOME: jsonOnlyFixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    expect(jsonOnly.diagnostics).toEqual([])
    expect(jsonOnly.config.task?.default_concurrency).toBe(9)
    expect(jsonOnly.sources[0]).toEqual({ exists: true, loaded: true, path: jsonOnlyPath, scope: "user" })

    // given
    const bothFixture = makeFixture()
    const jsoncPath = join(bothFixture.xdgConfigHome, "omo", "omo.jsonc")
    const jsonPath = join(bothFixture.xdgConfigHome, "omo", "omo.json")
    writeJsonc(jsonPath, `{"task":{"default_concurrency":8}}`)
    writeJsonc(jsoncPath, `{"task":{"default_concurrency":4}}`)

    // when
    const both = loadOmoConfig({
      cwd: bothFixture.cwd,
      env: { HOME: bothFixture.homeDir, XDG_CONFIG_HOME: bothFixture.xdgConfigHome },
      platform: "linux",
    })

    // then
    expect(both.diagnostics).toEqual([])
    expect(both.config.task?.default_concurrency).toBe(4)
    expect(both.sources[0]).toEqual({ exists: true, loaded: true, path: jsoncPath, scope: "user" })
  })
})
