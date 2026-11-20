import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { configSandbox, type ConfigSandbox, LAUNCH, modelChange, valueOf } from "./config-sandbox.test-support"
import { ENGINE_DEFAULT_FALLBACK_CHAINS, ENGINE_READ_AT_VERSION } from "./engine"

let sandbox: ConfigSandbox
afterEach(() => sandbox.cleanup())

describe("config.status files", () => {
  test("#given omo and engine files #when status runs #then every layer is listed with its path and load state", async () => {
    sandbox = configSandbox()
    const user = sandbox.userConfig({ categories: {} })
    const project = sandbox.projectConfig("{ not json")
    const engineGlobal = sandbox.engineGlobal({})
    const status = valueOf(await sandbox.config().status())
    expect(status.files).toContainEqual({ kind: "omo", scope: "user", path: user, exists: true, loaded: true, diagnostics: [] })
    expect(status.files).toContainEqual(
      expect.objectContaining({ kind: "omo", scope: "project", path: project, exists: true, loaded: false }),
    )
    expect(status.files.find((file) => file.path === project)?.diagnostics).toHaveLength(1)
    expect(status.files).toContainEqual({
      kind: "engine",
      scope: "global",
      path: engineGlobal,
      exists: true,
      loaded: true,
      diagnostics: [],
    })
    expect(status.files).toContainEqual({
      kind: "engine",
      scope: "project",
      path: join(sandbox.project, ".omo", "settings.json"),
      exists: false,
      loaded: false,
      diagnostics: [],
    })
  })

  test("#given an unparsable engine settings file #when status runs #then it is listed unloaded with a diagnostic", async () => {
    sandbox = configSandbox()
    const path = sandbox.engineGlobal("{ nope")
    const status = valueOf(await sandbox.config().status())
    const file = status.files.find((entry) => entry.path === path)
    expect(file).toMatchObject({ kind: "engine", exists: true, loaded: false })
    expect(file?.diagnostics.length).toBeGreaterThan(0)
  })

  test("#given a category keyed by an agent name #when status runs #then the category-shadow check reports it on that file", async () => {
    sandbox = configSandbox()
    const user = sandbox.userConfig({ categories: { explore: { model: "openai/gpt-5.5" } } })
    const status = valueOf(await sandbox.config().status())
    expect(status.files.find((file) => file.path === user)?.diagnostics).toHaveLength(1)
    expect(status.diagnostics).toHaveLength(1)
  })
})

describe("config.status routing", () => {
  test("#given a user category and no model list #when status runs #then sources and ordered chains are reported without a pick", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { model: "openai/gpt-5.5" } } })
    const { routing } = valueOf(await sandbox.config().status())
    const quick = routing.categories.find((entry) => entry.name === "quick")
    expect(quick?.source).toBe("user")
    expect(quick?.chain[0]).toBe("openai/gpt-5.5")
    expect(quick).not.toHaveProperty("pick")
    const deepLow = routing.categories.find((entry) => entry.name === "deep-low")
    expect(deepLow?.source).toBe("builtin")
    expect(deepLow?.chain.length).toBeGreaterThan(0)
    expect(routing.agents.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["explore", "librarian", "plan-consultant", "plan-reviewer"]),
    )
  })

  test("#given the machine's available models #when status runs #then each entry names the rung a spawn would pick", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { model: "openai/gpt-5.5" } } })
    const { routing } = valueOf(
      await sandbox.config().status({ models: [{ provider: "openai", id: "gpt-5.5" }] }),
    )
    expect(routing.categories.find((entry) => entry.name === "quick")?.pick).toBe("openai/gpt-5.5")
    expect(routing.agents.find((entry) => entry.name === "librarian")?.pick).toBeNull()
  })
})

describe("config.status engine", () => {
  test("#given an empty engine settings file #when status runs #then model fallback is on with the engine defaults", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({})
    const { engine } = valueOf(await sandbox.config().status())
    expect(engine.modelFallback).toBe(true)
    expect(engine.revertPolicy).toBe("cooldown-expiry")
    expect(engine.compaction).toEqual({
      enabled: true,
      speculativeEnabled: true,
      speculativeFraction: 0.75,
      speculativeCooldownMs: 30_000,
      idleCompactionEnabled: true,
    })
    expect(engine.backgroundSummaries).toBe("on")
    expect(engine.idleCompaction).toBe("on")
    expect(engine.speculativeFraction).toBe("no_effect")
    expect(engine.readAtEngineVersion).toBe(ENGINE_READ_AT_VERSION)
    expect(engine.installedEngineDiffers).toBe(false)
  })

  test("#given compaction.enabled false alone #when status runs #then background summaries stay on and idle compaction is off", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ compaction: { enabled: false } })
    const { engine } = valueOf(await sandbox.config().status())
    expect(engine.backgroundSummaries).toBe("on")
    expect(engine.idleCompaction).toBe("off")
  })

  test("#given compaction.enabled and speculativeEnabled both false #when status runs #then background summaries are off", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ compaction: { enabled: false, speculativeEnabled: false } })
    expect(valueOf(await sandbox.config().status()).engine.backgroundSummaries).toBe("off")
  })

  test("#given project engine settings #when status runs #then they override the global file", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ retry: { modelFallback: true } })
    sandbox.engineProject({ retry: { modelFallback: false, fallbackRevertPolicy: "never" } })
    const { engine } = valueOf(await sandbox.config().status())
    expect(engine.modelFallback).toBe(false)
    expect(engine.revertPolicy).toBe("never")
  })

  test("#given a model #when status runs #then its fallback chain is the default unless settings remove it", async () => {
    sandbox = configSandbox()
    const model = `${LAUNCH.provider}/${LAUNCH.model}`
    expect(valueOf(await sandbox.config().status({ model })).engine.fallbackChain).toEqual({
      model,
      chain: ENGINE_DEFAULT_FALLBACK_CHAINS[LAUNCH.model],
    })
    sandbox.engineGlobal({ retry: { fallbackChains: { [LAUNCH.model]: [] } } })
    expect(valueOf(await sandbox.config().status({ model })).engine.fallbackChain).toEqual({ model, chain: [] })
  })

  test("#given no model option #when status runs in a session #then the chain is the session's current model's", async () => {
    sandbox = configSandbox()
    const session = sandbox.session([modelChange("2026-11-09T12:00:01.000Z", "anthropic/claude-fable-5-2")])
    const { engine } = valueOf(await sandbox.config({ env: { PI_SESSION_FILE: session } }).status())
    expect(engine.fallbackChain?.model).toBe("anthropic/claude-fable-5-2")
  })

  test("#given an installed engine other than the read-at version #when status runs #then it says so", async () => {
    sandbox = configSandbox()
    const { engine } = valueOf(
      await sandbox.config({ ports: { engineVersion: () => "2026.12.30-1" } }).status(),
    )
    expect(engine.installedEngineVersion).toBe("2026.12.30-1")
    expect(engine.installedEngineDiffers).toBe(true)
  })
})
