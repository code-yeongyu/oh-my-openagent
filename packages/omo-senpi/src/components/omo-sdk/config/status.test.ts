import { afterEach, describe, expect, test } from "bun:test"

import { configSandbox, type ConfigSandbox, valueOf } from "./config-sandbox.test-support"
import { ENGINE_READ_AT_VERSION } from "./engine"
import { ENGINE_DEFAULT_FALLBACK_CHAINS } from "./engine-fallback-chains"

let sandbox: ConfigSandbox
afterEach(() => sandbox.cleanup())

describe("config.status routing", () => {
  test("#given a user category #when status runs #then sources and ordered chains are reported by name", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { model: "openai/gpt-5.5" } } })
    const { routing } = valueOf(await sandbox.config().status())
    const quick = routing.categories.find((entry) => entry.name === "quick")
    expect(quick?.source).toBe("user")
    expect(quick?.chain[0]).toBe("openai/gpt-5.5")
    expect(Object.keys(quick ?? {}).sort()).toEqual(["chain", "name", "source"])
    const deepLow = routing.categories.find((entry) => entry.name === "deep-low")
    expect(deepLow?.source).toBe("builtin")
    expect(deepLow?.chain.length).toBeGreaterThan(0)
    expect(routing.agents.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["explore", "librarian", "plan-consultant", "plan-reviewer"]),
    )
  })

  test("#given categories and agents a config file defines #when status runs #then only builtin names are listed", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({
      categories: { "Upper Case": { model: "openai/gpt-5.5" }, "my-lane": { model: "openai/gpt-5.5" } },
      agents: { "my-agent": { model: "openai/gpt-5.5" } },
    })
    const { routing } = valueOf(await sandbox.config().status())
    expect(JSON.stringify(routing)).not.toMatch(/Upper Case|my-lane|my-agent/)
    expect(routing.categories.map((entry) => entry.name)).toContain("quick")
  })

  test("#given a chain holding a credential-shaped model #when status runs #then that rung is dropped and the entry is marked withheld", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { models: ["openai/gpt-5.5", "sk-CANARYCANARYCANARYCANARY"] } } })
    const quick = valueOf(await sandbox.config().status()).routing.categories.find((entry) => entry.name === "quick")
    expect(quick).toMatchObject({ source: "user", value_withheld: true })
    expect(quick?.chain[0]).toBe("openai/gpt-5.5")
    expect(JSON.stringify(quick)).not.toContain("CANARY")
  })
})

describe("config.status engine", () => {
  test("#given an empty engine settings file #when status runs #then the engine defaults answer", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({})
    expect(valueOf(await sandbox.config().status()).engine).toEqual({
      compaction: {
        enabled: true,
        speculativeEnabled: true,
        speculativeFraction: 0.75,
        speculativeCooldownMs: 30_000,
        idleCompactionEnabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
      retry: {
        modelFallback: true,
        fallbackRevertPolicy: "cooldown-expiry",
        fallbackChains: ENGINE_DEFAULT_FALLBACK_CHAINS,
      },
      readAtEngineVersion: ENGINE_READ_AT_VERSION,
    })
  })

  test("#given project engine settings #when status runs #then they override the global file", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ retry: { modelFallback: true }, compaction: { reserveTokens: 8_000 } })
    sandbox.engineProject({ retry: { modelFallback: false, fallbackRevertPolicy: "never" } })
    const { engine } = valueOf(await sandbox.config().status())
    expect(engine.retry).toMatchObject({ modelFallback: false, fallbackRevertPolicy: "never" })
    expect(engine.compaction.reserveTokens).toBe(8_000)
  })

  test("#given a settings chain keyed or filled by credential-shaped ids #when status runs #then those chains are left out", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({
      retry: {
        fallbackChains: {
          "sk-CANARYCANARYCANARYCANARY": ["claude-opus-5"],
          "claude-opus-5-5": ["ghp_CANARYCANARYCANARYCANARY"],
          "claude-fable-5": ["claude-opus-5"],
        },
      },
    })
    const { engine } = valueOf(await sandbox.config().status())
    expect(engine.retry.fallbackChains["claude-fable-5"]).toEqual(["claude-opus-5"])
    expect(JSON.stringify(engine)).not.toContain("CANARY")
  })
})
