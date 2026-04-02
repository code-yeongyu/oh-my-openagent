/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"

import * as mcpLoader from "../features/claude-code-mcp-loader"
import * as mcpModule from "../mcp"
import * as shared from "../shared"

let loadMcpConfigsSpy: ReturnType<typeof spyOn>
let createBuiltinMcpsSpy: ReturnType<typeof spyOn>
let logSpy: ReturnType<typeof spyOn>

beforeEach(() => {
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
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

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
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

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
    const { applyMcpConfig } = await import("./mcp-config-handler")
    await applyMcpConfig({ config, pluginConfig, pluginComponents: EMPTY_PLUGIN_COMPONENTS })

    //#then
    const mergedMcp = config.mcp as Record<string, Record<string, unknown>>
    expect(mergedMcp.sharedServer.enabled).toBe(false)
    expect(mergedMcp.sharedServer.url).toBe("https://user.example.com")
    expect(logSpy).toHaveBeenCalledWith(
      'warning: MCP server "sharedServer" from user config overrides Claude Code .mcp.json'
    )
  })
})
