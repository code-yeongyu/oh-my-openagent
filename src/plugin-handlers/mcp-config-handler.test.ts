/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"

import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"

let loadMcpConfigsSpy: ReturnType<typeof spyOn>
let createBuiltinMcpsSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  loadMcpConfigsSpy = spyOn(mcpLoader, "loadMcpConfigs" as any).mockResolvedValue({
    servers: {},
  })
  createBuiltinMcpsSpy = spyOn(mcpModule, "createBuiltinMcps" as any).mockReturnValue({})
  spyOn(shared, "log" as any).mockImplementation(() => {})
})

afterEach(() => {
  loadMcpConfigsSpy.mockRestore()
  createBuiltinMcpsSpy.mockRestore()
  ;(shared.log as any)?.mockRestore?.()
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
    await applyMcpConfig({ config, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

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
    const pluginConfig = createPluginConfig({ disabled_mcps: ["playwright"] as any })

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({
      config,
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
    const pluginConfig = createPluginConfig({ disabled_mcps: ["firecrawl", "exa"] as any })

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

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
    await applyMcpConfig({ config, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp.exa.enabled).toBe(true)
    expect(mergedMcp.firecrawl.enabled).toBe(true)
  })

  test("deletes plugin MCPs that are in disabled_mcps", async () => {
    //#given
    const config: Record<string, unknown> = { mcp: {} }
    const pluginConfig = createPluginConfig({ disabled_mcps: ["plugin:custom"] as any })

    //#when
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({
      config,
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
})
