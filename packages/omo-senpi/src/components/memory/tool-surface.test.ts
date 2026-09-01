import { describe, expect, test } from "bun:test"

import type { SenpiExtensionAPI } from "../../extension/types"
import { MEMORY_MCP_SERVER_NAME, registerMemoryToolSurface } from "./tools"

// Regression (session 019fe95c-09d2): routing the memory tools through an extension-registered MCP
// server left them UNREACHABLE - the declaration missing `enabled: true` resolved as state "disabled"
// in senpi, the server never started, and no memory surface existed at all. Direct registration is
// therefore the default; the search exposure is an explicit opt-in that must declare enabled: true.

interface Captured {
  tools: string[]
  mcpServers: Array<{ name: string; config: Record<string, unknown> }>
}

function apiWithMcpSupport(): { api: SenpiExtensionAPI; captured: Captured } {
  const captured: Captured = { tools: [], mcpServers: [] }
  const api = {
    registerTool: (tool: { name: string }) => { captured.tools.push(tool.name) },
    registerMcpServer: (name: string, config: Record<string, unknown>) => {
      captured.mcpServers.push({ name, config })
    },
  } as unknown as SenpiExtensionAPI
  return { api, captured }
}

function apiWithoutMcpSupport(): { api: SenpiExtensionAPI; captured: Captured } {
  const captured: Captured = { tools: [], mcpServers: [] }
  const api = {
    registerTool: (tool: { name: string }) => { captured.tools.push(tool.name) },
  } as unknown as SenpiExtensionAPI
  return { api, captured }
}

describe("registerMemoryToolSurface", () => {
  describe("#given the default surface", () => {
    test("#when the host supports MCP servers #then the tools STILL register directly", () => {
      const { api, captured } = apiWithMcpSupport()
      registerMemoryToolSurface(api, () => undefined)
      expect(captured.tools).toEqual(["memory", "memory_apply_patch"])
      expect(captured.mcpServers).toHaveLength(0)
    })
  })

  describe("#given the explicit search exposure opt-in", () => {
    test("#when the host supports MCP servers #then the server registers enabled with search exposure", () => {
      const { api, captured } = apiWithMcpSupport()
      registerMemoryToolSurface(api, () => undefined, { exposure: "search" })
      expect(captured.tools).toHaveLength(0)
      expect(captured.mcpServers).toHaveLength(1)
      const [server] = captured.mcpServers
      expect(server?.name).toBe(MEMORY_MCP_SERVER_NAME)
      expect(server?.config["exposure"]).toBe("search")
      expect(server?.config["enabled"]).toBe(true)
      expect(String((server?.config["args"] as string[])[0])).toEndWith("omo-memory-mcp.js")
    })

    test("#when the host lacks registerMcpServer #then direct registration is the fallback", () => {
      const { api, captured } = apiWithoutMcpSupport()
      registerMemoryToolSurface(api, () => undefined, { exposure: "search" })
      expect(captured.tools).toEqual(["memory", "memory_apply_patch"])
    })
  })
})
