/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"

import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

let loadMcpConfigsSpy: ReturnType<typeof spyOn>
let createBuiltinMcpsSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  loadMcpConfigsSpy = spyOn(mcpLoader, unsafeTestValue("loadMcpConfigs")).mockResolvedValue({
    servers: {},
  })
  createBuiltinMcpsSpy = spyOn(mcpModule, unsafeTestValue("createBuiltinMcps")).mockReturnValue({})
  spyOn(shared, unsafeTestValue("log")).mockImplementation(() => {})
})

afterEach(() => {
  loadMcpConfigsSpy.mockRestore()
  createBuiltinMcpsSpy.mockRestore()
  ;(unsafeTestValue(shared.log))?.mockRestore?.()
})

function createPluginConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return {
    disabled_mcps: [],
    ...overrides,
  } as OhMyOpenCodeConfig
}

const EMPTY_PLUGIN_COMPONENTS = {
  commands: {},
  skills: {},
  agents: {},
  mcpServers: {},
  hooksConfigs: [],
  plugins: [],
  errors: [],
}

const TEST_CTX = { directory: "/workspace/project" }

describe("applyMcpConfig", () => {
  test("preserves enabled:false from user config after merge with .mcp.json MCPs", async () => {
    //#given
    const userMcp = {
      firecrawl: { type: "remote", url: "https://firecrawl.example.com", enabled: false },
      exa: { type: "remote", url: "https://exa.example.com", enabled: true },
    }

    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        firecrawl: { type: "remote", url: "https://firecrawl.example.com", enabled: true },
        exa: { type: "remote", url: "https://exa.example.com", enabled: true },
      },
    })

    const config: Record<string, unknown> = { mcp: userMcp }
    const pluginConfig = createPluginConfig()

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp.firecrawl.enabled).toBe(false)
    expect(mergedMcp.exa.enabled).toBe(true)
  })

  test("applies disabled_mcps to MCPs from all sources", async () => {
    //#given
    createBuiltinMcpsSpy.mockReturnValue({
      websearch: { type: "remote", url: "https://mcp.exa.ai/mcp", enabled: true },
    })

    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        playwright: { type: "local", command: ["npx", "@playwright/mcp"], enabled: true },
      },
    })

    const config: Record<string, unknown> = { mcp: {} }
    const pluginConfig = createPluginConfig({ disabled_mcps: unsafeTestValue(["playwright"]) })

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({
      config,
      ctx: TEST_CTX,
      pluginConfig,
      pluginComponents: {
        ...EMPTY_PLUGIN_COMPONENTS,
        mcpServers: {
          "plugin:custom": { type: "local", command: ["npx", "custom"], enabled: true },
        },
      },
    })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp).not.toHaveProperty("playwright")
    expect(mergedMcp).toHaveProperty("websearch")
    expect(mergedMcp).toHaveProperty("plugin:custom")
  })

  test("passes disabled_mcps to loadMcpConfigs", async () => {
    //#given
    const config: Record<string, unknown> = { mcp: {} }
    const pluginConfig = createPluginConfig({ disabled_mcps: unsafeTestValue(["firecrawl", "exa"]) })

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    expect(loadMcpConfigsSpy).toHaveBeenCalledWith(["firecrawl", "exa"])
  })

  test("works when no user MCPs have enabled:false", async () => {
    //#given
    const userMcp = {
      exa: { type: "remote", url: "https://exa.example.com", enabled: true },
    }

    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        firecrawl: { type: "remote", url: "https://firecrawl.example.com", enabled: true },
      },
    })

    const config: Record<string, unknown> = { mcp: userMcp }
    const pluginConfig = createPluginConfig()

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp.exa.enabled).toBe(true)
    expect(mergedMcp.firecrawl.enabled).toBe(true)
  })

  test("deletes plugin MCPs that are in disabled_mcps", async () => {
    //#given
    const config: Record<string, unknown> = { mcp: {} }
    const pluginConfig = createPluginConfig({ disabled_mcps: unsafeTestValue(["plugin:custom"]) })

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({
      config,
      ctx: TEST_CTX,
      pluginConfig,
      pluginComponents: {
        ...EMPTY_PLUGIN_COMPONENTS,
        mcpServers: {
          "plugin:custom": { type: "local", command: ["npx", "custom"], enabled: true },
        },
      },
    })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp).not.toHaveProperty("plugin:custom")
  })

  test("passes the OpenCode workspace directory into built-in MCP config", async () => {
    //#given
    const config: Record<string, unknown> = { mcp: {} }
    const pluginConfig = createPluginConfig()

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    expect(createBuiltinMcpsSpy).toHaveBeenCalledWith([], pluginConfig, { cwd: TEST_CTX.directory })
  })

  // regression: issue #4178 — `/new` triggers OpenCode to re-evaluate `config`,
  // which re-invokes this handler. When that happens, `params.config.mcp` may have
  // been reset to the raw merged set (re-introducing disabled entries). The
  // handler must still produce a filtered `config.mcp` regardless of input shape.
  test("re-applying after the session config gets reset still filters disabled_mcps", async () => {
    //#given: first invocation — plugin init
    createBuiltinMcpsSpy.mockReturnValue({
      websearch: { type: "remote", url: "https://mcp.exa.ai/mcp", enabled: true },
    })
    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        firecrawl: { type: "remote", url: "https://firecrawl.example.com", enabled: true },
        exa: { type: "remote", url: "https://exa.example.com", enabled: true },
      },
    })
    const userMcpRaw = {
      "user-disabled-server": { type: "local", command: ["foo"], enabled: true },
      "user-keep-me": { type: "local", command: ["bar"], enabled: true },
    }
    const config: Record<string, unknown> = { mcp: { ...userMcpRaw } }
    const pluginConfig = createPluginConfig({
      disabled_mcps: unsafeTestValue(["firecrawl", "user-disabled-server"]),
    })

    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then: first pass — disabled entries are gone
    let merged = config.mcp as Record<string, Record<string, unknown>>
    expect(merged).not.toHaveProperty("firecrawl")
    expect(merged).not.toHaveProperty("user-disabled-server")
    expect(merged).toHaveProperty("websearch")
    expect(merged).toHaveProperty("exa")
    expect(merged).toHaveProperty("user-keep-me")

    //#when: simulate `/new` — the runtime resets config.mcp back to the raw user
    // map (re-introducing the disabled entries) and re-invokes the config handler
    config.mcp = { ...userMcpRaw }
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then: second pass must produce the same filtered set
    merged = config.mcp as Record<string, Record<string, unknown>>
    expect(merged).not.toHaveProperty("firecrawl")
    expect(merged).not.toHaveProperty("user-disabled-server")
    expect(merged).toHaveProperty("websearch")
    expect(merged).toHaveProperty("exa")
    expect(merged).toHaveProperty("user-keep-me")
  })

  // Additional regression: ensure disabled filter survives when the same disabled
  // entry was previously stripped — i.e. there is no path where the handler
  // assumes the previous filtered set is the baseline.
  test("idempotent across N invocations with disabled_mcps", async () => {
    //#given
    createBuiltinMcpsSpy.mockReturnValue({})
    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        auggie: { type: "local", command: ["x"], enabled: true },
      },
    })
    const config: Record<string, unknown> = {
      mcp: { auggie: { type: "local", command: ["x"], enabled: true } },
    }
    const pluginConfig = createPluginConfig({ disabled_mcps: unsafeTestValue(["auggie"]) })

    const { applyMcpConfig } = await import("./mcp-config-handler")

    //#when: 3 invocations in a row, each time the runtime hands us raw mcp again
    for (let i = 0; i < 3; i++) {
      config.mcp = { auggie: { type: "local", command: ["x"], enabled: true } }
      await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })
      //#then
      expect(config.mcp).not.toHaveProperty("auggie")
    }
  })
})
