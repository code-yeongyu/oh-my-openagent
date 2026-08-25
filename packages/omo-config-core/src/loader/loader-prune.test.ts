import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { loadOmoConfig } from "../index"

function writeJsonc(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function makeFixture(): { readonly homeDir: string; readonly cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-config-prune-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project", "child")
  mkdirSync(cwd, { recursive: true })
  return { homeDir, cwd }
}

describe("loadOmoConfig surgical pruning", () => {
  test("#given valid agents.sisyphus plus invalid key in agents.oracle #when loading #then sisyphus survives and oracle is dropped with one diagnostic", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, "project", ".omo", "omo.jsonc"),
      `{
        "agents": {
          "sisyphus": { "model": "anthropic/claude-opus-5" },
          "oracle": { "model": "kimi-k3", "bogus_key": 1 }
        }
      }`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir },
      platform: "linux",
    })

    // then
    expect(result.config.agents?.sisyphus?.model).toBe("anthropic/claude-opus-5")
    expect(result.config.agents?.oracle).toBeUndefined()
    const dropped = result.diagnostics.filter((d) => d.kind === "validation" && d.path === "agents.oracle")
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.issuePaths).toContain("agents.oracle")
  })

  test("#given multiple invalid agent entries across different names #when loading #then all are pruned with one diagnostic each", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, "project", ".omo", "omo.jsonc"),
      `{
        "agents": {
          "sisyphus": { "model": "anthropic/claude-opus-5" },
          "oracle": { "bogus_key": 1 },
          "explore": { "bogus_key": 2 }
        }
      }`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir },
      platform: "linux",
    })

    // then
    expect(result.config.agents?.sisyphus?.model).toBe("anthropic/claude-opus-5")
    expect(result.config.agents?.oracle).toBeUndefined()
    expect(result.config.agents?.explore).toBeUndefined()
    const dropped = result.diagnostics.filter((d) => d.kind === "validation" && d.path?.startsWith("agents."))
    expect(dropped).toHaveLength(2)
  })

  test("#given a bad categories leaf #when loading #then categories pruning is symmetric and other categories survive", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, "project", ".omo", "omo.jsonc"),
      `{
        "categories": {
          "quick": { "model": "gpt-5.6" },
          "deep": { "bogus_key": 1 }
        }
      }`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir },
      platform: "linux",
    })

    // then
    expect(result.config.categories?.quick?.model).toBe("gpt-5.6")
    expect(result.config.categories?.deep).toBeUndefined()
    const dropped = result.diagnostics.filter((d) => d.kind === "validation" && d.path === "categories.deep")
    expect(dropped).toHaveLength(1)
  })

  test("#given config broken beyond record leaves #when loading #then defaults are returned with a validation diagnostic", () => {
    // given
    const fixture = makeFixture()
    writeJsonc(
      join(fixture.homeDir, "project", ".omo", "omo.jsonc"),
      `{
        "agents": { "oracle": { "model": "kimi-k3", "bogus_key": 1 } },
        "task": { "default_concurrency": "not-a-number" }
      }`,
    )

    // when
    const result = loadOmoConfig({
      cwd: fixture.cwd,
      env: { HOME: fixture.homeDir },
      platform: "linux",
    })

    // then
    expect(result.config.agents?.oracle).toBeUndefined()
    expect(result.config.task?.default_concurrency).toBe(5)
    expect(result.diagnostics.some((d) => d.kind === "validation")).toBe(true)
  })
})
