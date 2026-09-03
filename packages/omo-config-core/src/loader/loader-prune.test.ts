import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { loadOmoConfig } from "../index"

function makeFixture(): { readonly cwd: string; readonly homeDir: string; readonly root: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-config-prune-"))
  const homeDir = join(root, "home")
  const cwd = join(homeDir, "project", "child")
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, root }
}

function writeProjectConfig(homeDir: string, content: string): void {
  mkdirSync(join(homeDir, "project", ".omo"), { recursive: true })
  writeFileSync(join(homeDir, "project", ".omo", "omo.jsonc"), content)
}

function load(fixture: { readonly cwd: string; readonly homeDir: string }) {
  return loadOmoConfig({
    cwd: fixture.cwd,
    env: { HOME: fixture.homeDir },
    platform: "linux",
  })
}

describe("loadOmoConfig surgical pruning", () => {
  test("#given valid agents.sisyphus plus an unknown key inside agents.oracle #when loading #then oracle survives with its model and one unknown-keys diagnostic names the stripped key", () => {
    // given
    const fixture = makeFixture()
    writeProjectConfig(
      fixture.homeDir,
      `{
        "agents": {
          "sisyphus": { "model": "anthropic/claude-opus-5" },
          "oracle": { "model": "kimi-k3", "bogus_key": 1 }
        }
      }`,
    )

    try {
      // when
      const result = load(fixture)

      // then
      expect(result.config.agents?.sisyphus?.model).toBe("anthropic/claude-opus-5")
      expect(result.config.agents?.oracle?.model).toBe("kimi-k3")
      expect(result.sources.some((source) => source.loaded)).toBe(true)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toMatchObject({
        kind: "unknown-keys",
        issuePaths: ["agents.oracle.bogus_key"],
      })
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a wrong-typed model value in agents.oracle beside a valid agents.sisyphus #when loading #then sisyphus survives, oracle is pruned, and one validation diagnostic names agents.oracle", () => {
    // given
    const fixture = makeFixture()
    writeProjectConfig(
      fixture.homeDir,
      `{
        "agents": {
          "sisyphus": { "model": "anthropic/claude-opus-5" },
          "oracle": { "model": 123 }
        }
      }`,
    )

    try {
      // when
      const result = load(fixture)

      // then
      expect(result.config.agents?.sisyphus?.model).toBe("anthropic/claude-opus-5")
      expect(result.config.agents?.oracle).toBeUndefined()
      expect(result.sources.some((source) => source.loaded)).toBe(true)
      const dropped = result.diagnostics.filter((d) => d.kind === "validation" && d.path === "agents.oracle")
      expect(dropped).toHaveLength(1)
      expect(dropped[0]?.issuePaths?.[0]).toBe("agents.oracle.model")
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given multiple wrong-typed agent leaves beside a valid one #when loading #then every invalid leaf is pruned with one diagnostic each", () => {
    // given
    const fixture = makeFixture()
    writeProjectConfig(
      fixture.homeDir,
      `{
        "agents": {
          "sisyphus": { "model": "anthropic/claude-opus-5" },
          "oracle": { "model": 123 },
          "explore": { "model": 456 }
        }
      }`,
    )

    try {
      // when
      const result = load(fixture)

      // then
      expect(result.config.agents?.sisyphus?.model).toBe("anthropic/claude-opus-5")
      expect(result.config.agents?.oracle).toBeUndefined()
      expect(result.config.agents?.explore).toBeUndefined()
      const dropped = result.diagnostics.filter((d) => d.kind === "validation" && d.path?.startsWith("agents."))
      expect(dropped).toHaveLength(2)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a wrong-typed categories leaf beside a valid one #when loading #then categories pruning is symmetric and the valid category survives", () => {
    // given
    const fixture = makeFixture()
    writeProjectConfig(
      fixture.homeDir,
      `{
        "categories": {
          "quick": { "model": "gpt-5.6" },
          "deep": { "model": 123 }
        }
      }`,
    )

    try {
      // when
      const result = load(fixture)

      // then
      expect(result.config.categories?.quick?.model).toBe("gpt-5.6")
      expect(result.config.categories?.deep).toBeUndefined()
      const dropped = result.diagnostics.filter((d) => d.kind === "validation" && d.path === "categories.deep")
      expect(dropped).toHaveLength(1)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given an invalid agent leaf beside a malformed non-record value #when loading #then the layer is rejected wholesale and defaults are returned with a validation diagnostic", () => {
    // given
    const fixture = makeFixture()
    writeProjectConfig(
      fixture.homeDir,
      `{
        "agents": { "oracle": { "model": 123 } },
        "task": { "default_concurrency": "not-a-number" }
      }`,
    )

    try {
      // when
      const result = load(fixture)

      // then
      expect(result.config.agents?.oracle).toBeUndefined()
      expect(result.config.task?.default_concurrency).toBe(5)
      expect(result.sources.every((source) => !source.loaded)).toBe(true)
      expect(result.diagnostics.some((d) => d.kind === "validation")).toBe(true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a layer whose only issue is a malformed non-record value with no agents or categories keys #when loading #then the record-leaf gate rejects the layer instead of prune-attempting it", () => {
    // given
    const fixture = makeFixture()
    writeProjectConfig(
      fixture.homeDir,
      `{
        "task": { "default_concurrency": "not-a-number" }
      }`,
    )

    try {
      // when
      const result = load(fixture)

      // then
      expect(result.config.task?.default_concurrency).toBe(5)
      expect(result.sources.every((source) => !source.loaded)).toBe(true)
      expect(result.diagnostics.some((d) => d.kind === "validation")).toBe(true)
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })

  test("#given a prototype-pollution payload nested under agents.evil beside a prunable invalid leaf #when loading #then the pollution guard rejects the layer fail-closed instead of pruning and accepting", () => {
    // given
    const fixture = makeFixture()
    writeProjectConfig(
      fixture.homeDir,
      `{"agents":{"evil":{"__proto__":{"x":1},"model":123}}}`,
    )

    try {
      // when
      const result = load(fixture)

      // then
      expect(result.config.agents?.evil).toBeUndefined()
      expect(result.sources.every((source) => !source.loaded)).toBe(true)
      expect(result.diagnostics.some((d) => d.kind === "validation")).toBe(true)
      expect(({} as Record<string, unknown>).x).toBeUndefined()
    } finally {
      rmSync(fixture.root, { force: true, recursive: true })
    }
  })
})
