/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"

import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"

let loadMcpConfigsSpy: ReturnType<typeof spyOn>
let createBuiltinMcpsSpy: ReturnType<typeof spyOn>
let logSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  mock.restore()

  loadMcpConfigsSpy = spyOn(mcpLoader, "loadMcpConfigs").mockResolvedValue({
    servers: {},
    loadedServers: [],
  })
  createBuiltinMcpsSpy = spyOn(mcpModule, "createBuiltinMcps").mockReturnValue({})
  logSpy = spyOn(shared, "log").mockImplementation(() => {})
})

afterEach(() => {
  loadMcpConfigsSpy.mockRestore()
  createBuiltinMcpsSpy.mockRestore()
  logSpy.mockRestore()
  mock.restore()
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

async function importFreshMcpConfigHandlerModule(): Promise<typeof import("./mcp-config-handler")> {
  return import(`./mcp-config-handler?test=${Date.now()}-${Math.random()}`)
}

describe("applyMcpConfig collision handling", () => {
  test("merges without collision when names are unique", async () => {
    //#given
    const userMcp = {
      userServer: { type: "remote", url: "https://user.example.com", enabled: true },
    }

    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        claudeServer: { type: "remote", url: "https://claude.example.com", enabled: true },
      },
      loadedServers: [],
    })

    const config: Record<string, unknown> = { mcp: userMcp }
    const pluginConfig = createPluginConfig()

    //#when
    const { applyMcpConfig } = await importFreshMcpConfigHandlerModule()
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp).toHaveProperty("userServer")
    expect(mergedMcp).toHaveProperty("claudeServer")
    expect(mergedMcp.userServer.enabled).toBe(true)
    expect(mergedMcp.claudeServer.enabled).toBe(true)
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("overrides Claude Code"))
  })

  test("user config wins on collision with Claude Code and logs warning", async () => {
    //#given
    const userMcp = {
      sharedServer: { type: "remote", url: "https://user.example.com", enabled: true },
    }

    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        sharedServer: { type: "remote", url: "https://claude.example.com", enabled: true },
      },
      loadedServers: [],
    })

    const config: Record<string, unknown> = { mcp: userMcp }
    const pluginConfig = createPluginConfig()

    //#when
    const { applyMcpConfig } = await importFreshMcpConfigHandlerModule()
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp.sharedServer.url).toBe("https://user.example.com")
    expect(logSpy).toHaveBeenCalledWith(
      'warning: MCP server "sharedServer" from user config overrides Claude Code .mcp.json'
    )
  })

  test("preserves enabled:false from user config after collision with Claude Code", async () => {
    //#given
    const userMcp = {
      sharedServer: { type: "remote", url: "https://user.example.com", enabled: false },
    }

    loadMcpConfigsSpy.mockResolvedValue({
      servers: {
        sharedServer: { type: "remote", url: "https://claude.example.com", enabled: true },
      },
      loadedServers: [],
    })

    const config: Record<string, unknown> = { mcp: userMcp }
    const pluginConfig = createPluginConfig()

    //#when
    const { applyMcpConfig } = await importFreshMcpConfigHandlerModule()
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp.sharedServer.enabled).toBe(false)
    expect(mergedMcp.sharedServer.url).toBe("https://user.example.com")
    expect(logSpy).toHaveBeenCalledWith(
      'warning: MCP server "sharedServer" from user config overrides Claude Code .mcp.json'
    )
  })
})

describe("applyMcpConfig plugin MCP deduplication", () => {
  test("skips namespaced plugin MCP whose bare server name collides with a native MCP", async () => {
    //#given
    // Issue #2989: a Claude Code Figma plugin contributes "figma:figma" while the user
    // already has a native "figma" MCP. OpenCode keys OAuth state by MCP name, so the
    // namespaced duplicate can never satisfy the stored "figma" tokens and re-prompts
    // for auth on every start.
    const userMcp = {
      figma: { type: "remote", url: "https://mcp.figma.com/mcp", enabled: true },
    }

    loadMcpConfigsSpy.mockResolvedValue({ servers: {}, loadedServers: [] })

    const config: Record<string, unknown> = { mcp: userMcp }
    const pluginConfig = createPluginConfig()
    const pluginComponents = {
      ...EMPTY_PLUGIN_COMPONENTS,
      mcpServers: {
        "figma:figma": { type: "remote", url: "https://mcp.figma.com/mcp", enabled: true },
      },
    }

    //#when
    const { applyMcpConfig } = await importFreshMcpConfigHandlerModule()
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp).not.toHaveProperty("figma:figma")
    expect(mergedMcp.figma.url).toBe("https://mcp.figma.com/mcp")
    expect(logSpy).toHaveBeenCalledWith(
      'warning: skipping plugin MCP server "figma:figma"; native MCP server "figma" already exists'
    )
  })

  test("keeps namespaced plugin MCP when no native server shares its bare name", async () => {
    //#given
    loadMcpConfigsSpy.mockResolvedValue({ servers: {}, loadedServers: [] })

    const config: Record<string, unknown> = {}
    const pluginConfig = createPluginConfig()
    const pluginComponents = {
      ...EMPTY_PLUGIN_COMPONENTS,
      mcpServers: {
        "demo-plugin:onlyInPlugin": { type: "remote", url: "https://plugin.example.com", enabled: true },
      },
    }

    //#when
    const { applyMcpConfig } = await importFreshMcpConfigHandlerModule()
    await applyMcpConfig({ config, ctx: TEST_CTX, pluginConfig, pluginComponents })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp).toHaveProperty("demo-plugin:onlyInPlugin")
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("skipping plugin MCP server"))
  })
})
