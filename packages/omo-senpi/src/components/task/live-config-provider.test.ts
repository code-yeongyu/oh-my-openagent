import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ComponentLogger } from "../../extension/types"
import { loadSenpiOmoConfig, type SenpiConfigDiagnostic, type SenpiOmoConfigResult } from "../config-resolution"
import { createLiveConfigProvider } from "./live-config-provider"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function configFixture(): {
  readonly project: string
  readonly write: (text: string) => void
  readonly writeProject: (text: string) => void
  readonly load: (options: { cwd: string }) => SenpiOmoConfigResult
} {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-live-config-"))
  roots.push(root)
  const home = join(root, "home")
  const project = join(home, "project")
  mkdirSync(join(home, ".omo"), { recursive: true })
  mkdirSync(project, { recursive: true })
  return {
    project,
    write: (text) => writeFileSync(join(home, ".omo", "omo.jsonc"), text, "utf8"),
    writeProject: (text) => {
      mkdirSync(join(project, ".omo"), { recursive: true })
      writeFileSync(join(project, ".omo", "omo.jsonc"), text, "utf8")
    },
    load: ({ cwd }) => loadSenpiOmoConfig({ cwd, env: { HOME: home }, platform: "linux" }),
  }
}

function createTestLogger(): ComponentLogger & { warnings: Array<{ message: string; meta?: unknown }> } {
  const warnings: Array<{ message: string; meta?: unknown }> = []
  return {
    warnings,
    info: () => {},
    warn: (message, meta) => warnings.push({ message, meta }),
    error: () => {},
  }
}

function createFakeClock(): { readonly now: () => number; readonly advance: (ms: number) => void } {
  let current = 1_000
  return { now: () => current, advance: (ms) => { current += ms } }
}

function mockResult(config: OmoConfig, diagnostics: readonly SenpiConfigDiagnostic[] = []): SenpiOmoConfigResult {
  return {
    config,
    diagnostics,
    layers: [],
    sources: [],
  }
}

describe("createLiveConfigProvider", () => {
  it("#given an initial config #when read immediately #then returns the initial config without reloading", () => {
    // given
    const clock = createFakeClock()
    const initialConfig: OmoConfig = { categories: { quick: { model: "initial-provider/model-a" } } }
    let loadCount = 0
    const loadConfig = (): SenpiOmoConfigResult => {
      loadCount++
      return mockResult(initialConfig)
    }
    const logger = createTestLogger()

    const provider = createLiveConfigProvider({
      cwd: "/test/cwd",
      loadConfig,
      initialResult: mockResult(initialConfig),
      logger,
      cacheTtlMs: 250,
      now: clock.now,
    })

    // when read multiple times within TTL
    const first = provider()
    const second = provider()

    // then
    expect(first).toEqual(initialConfig)
    expect(second).toEqual(initialConfig)
    expect(loadCount).toBe(0)
  })

  it("#given an updated config without diagnostics #when cache TTL expires #then adopts the new config", () => {
    // given
    const clock = createFakeClock()
    const initialConfig: OmoConfig = { categories: { quick: { model: "initial-provider/model-a" } } }
    const updatedConfig: OmoConfig = { categories: { quick: { model: "updated-provider/model-b" } } }
    let currentConfig = initialConfig
    let loadCount = 0

    const loadConfig = (): SenpiOmoConfigResult => {
      loadCount++
      return mockResult(currentConfig)
    }
    const logger = createTestLogger()

    const provider = createLiveConfigProvider({
      cwd: "/test/cwd",
      loadConfig,
      initialResult: mockResult(initialConfig),
      logger,
      cacheTtlMs: 10,
      now: clock.now,
    })

    expect(provider()).toEqual(initialConfig)

    // when time passes beyond TTL and config changes cleanly
    currentConfig = updatedConfig
    clock.advance(20)
    const reloaded = provider()

    // then
    expect(reloaded).toEqual(updatedConfig)
    expect(loadCount).toBe(1)
    expect(logger.warnings).toHaveLength(0)
  })

  it("#given a reload with diagnostics #when read #then retains last good config and logs a warning", () => {
    // given
    const clock = createFakeClock()
    const goodConfig: OmoConfig = { categories: { quick: { model: "good-provider/model-good" } } }
    const brokenConfig: OmoConfig = {} // would be empty/default fallback on loader error
    const diagnostic: SenpiConfigDiagnostic = {
      path: "/test/cwd/.omo/omo.json",
      message: "JSONC syntax error: unexpected token",
      kind: "parse",
    }
    let returnDiagnostics = false

    const loadConfig = (): SenpiOmoConfigResult => {
      if (returnDiagnostics) {
        return mockResult(brokenConfig, [diagnostic])
      }
      return mockResult(goodConfig)
    }
    const logger = createTestLogger()

    const provider = createLiveConfigProvider({
      cwd: "/test/cwd",
      loadConfig,
      initialResult: mockResult(goodConfig),
      logger,
      cacheTtlMs: 10,
      now: clock.now,
    })

    expect(provider()).toEqual(goodConfig)

    // when reload produces diagnostics
    returnDiagnostics = true
    clock.advance(20)
    const result = provider()

    // then
    expect(result).toEqual(goodConfig) // retained last good config!
    expect(logger.warnings).toHaveLength(1)
    expect(logger.warnings[0].message).toContain("retaining last good configuration")
  })

  it("#given an on-disk edit that also carries one unknown key #when reloaded #then the edit still applies because unknown keys are a warning", () => {
    // given
    const fixture = configFixture()
    fixture.write(JSON.stringify({ categories: { quick: { model: "initial-provider/model-a" } } }))
    const initialResult = fixture.load({ cwd: fixture.project })
    const logger = createTestLogger()
    const provider = createLiveConfigProvider({
      cwd: fixture.project,
      loadConfig: fixture.load,
      initialResult,
      logger,
      cacheTtlMs: 0,
    })
    expect(provider().categories?.quick?.model).toBe("initial-provider/model-a")

    // when a mid-session edit changes the model and adds a key the schema does not know
    fixture.write(JSON.stringify({ categories: { quick: { model: "updated-provider/model-b" } }, not_a_real_key: true }))
    const reloaded = provider()

    // then the loader reports the ignored key, yet the new model is live
    expect(fixture.load({ cwd: fixture.project }).diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["unknown-keys"])
    expect(reloaded.categories?.quick?.model).toBe("updated-provider/model-b")
  })

  it("#given an on-disk edit with a JSONC syntax error #when reloaded past several cache windows #then the last good config is retained and the warning is logged once", () => {
    // given
    const fixture = configFixture()
    fixture.write(JSON.stringify({ categories: { quick: { model: "good-provider/model-good" } } }))
    const initialResult = fixture.load({ cwd: fixture.project })
    const logger = createTestLogger()
    const provider = createLiveConfigProvider({
      cwd: fixture.project,
      loadConfig: fixture.load,
      initialResult,
      logger,
      cacheTtlMs: 0,
    })

    // when the file stops parsing and stays broken across reloads
    fixture.write("{ \"categories\": { \"quick\": ")
    const result = provider()
    const again = provider()

    // then the broken layer does not silently reset the planner to defaults, and the same cause warns once
    expect(result.categories?.quick?.model).toBe("good-provider/model-good")
    expect(again.categories?.quick?.model).toBe("good-provider/model-good")
    expect(logger.warnings).toHaveLength(1)
    expect(logger.warnings[0].message).toContain("retaining last good configuration")
  })

  it("#given an edit that adds a model profile shadowing a catalog entry #when reloaded #then the edit applies because that notice drops nothing", () => {
    // given
    const fixture = configFixture()
    fixture.write(JSON.stringify({ categories: { quick: { model: "a/one" } } }))
    const initialResult = fixture.load({ cwd: fixture.project })
    const provider = createLiveConfigProvider({
      cwd: fixture.project,
      loadConfig: fixture.load,
      initialResult,
      logger: createTestLogger(),
      cacheTtlMs: 0,
    })

    // when the edit moves quick and adds a profile named like a catalog entry
    fixture.write(JSON.stringify({
      categories: { quick: { model: "b/two" } },
      models: { capable: { model: "b/two" } },
      model_profiles: { capable: { models: ["b/two"] } },
    }))
    const reloaded = provider()

    // then the loader reports the shadowing as validation, yet the new model is live
    expect(fixture.load({ cwd: fixture.project }).diagnostics.map((diagnostic) => diagnostic.kind)).toContain("validation")
    expect(reloaded.categories?.quick?.model).toBe("b/two")
  })

  it("#given a broken project layer already present at startup #when the user layer is edited #then the edit applies because that error was already accepted", () => {
    // given a session that started with a project omo.jsonc that does not parse
    const fixture = configFixture()
    fixture.write(JSON.stringify({ categories: { quick: { model: "a/one" } } }))
    fixture.writeProject("{ \"categories\": ")
    const initialResult = fixture.load({ cwd: fixture.project })
    const logger = createTestLogger()
    const provider = createLiveConfigProvider({
      cwd: fixture.project,
      loadConfig: fixture.load,
      initialResult,
      logger,
      cacheTtlMs: 0,
    })

    // when the user layer moves quick while the project layer stays broken the same way
    fixture.write(JSON.stringify({ categories: { quick: { model: "b/two" } } }))
    const reloaded = provider()

    // then the startup error does not freeze the planner on the startup snapshot
    expect(initialResult.diagnostics.map((diagnostic) => diagnostic.kind)).toContain("parse")
    expect(reloaded.categories?.quick?.model).toBe("b/two")
    expect(logger.warnings).toEqual([])
  })

  it("#given a reload that throws an error #when read #then retains last good config and logs a warning", () => {
    // given
    const clock = createFakeClock()
    const goodConfig: OmoConfig = { categories: { quick: { model: "good-provider/model-good" } } }
    let shouldThrow = false

    const loadConfig = (): SenpiOmoConfigResult => {
      if (shouldThrow) {
        throw new Error("EPERM: disk read collision")
      }
      return mockResult(goodConfig)
    }
    const logger = createTestLogger()

    const provider = createLiveConfigProvider({
      cwd: "/test/cwd",
      loadConfig,
      initialResult: mockResult(goodConfig),
      logger,
      cacheTtlMs: 10,
      now: clock.now,
    })

    expect(provider()).toEqual(goodConfig)

    // when loader throws
    shouldThrow = true
    clock.advance(20)
    const result = provider()

    // then
    expect(result).toEqual(goodConfig)
    expect(logger.warnings).toHaveLength(1)
    expect(logger.warnings[0].message).toContain("retaining last good configuration")
  })
})
