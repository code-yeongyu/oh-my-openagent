import { describe, expect, it, mock, spyOn } from "bun:test"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { SkillMcpManager } from "./manager"
import { buildRequestOptions, resolveRequestTimeoutMs } from "./request-options"
import type { McpClient, SkillMcpClientInfo, SkillMcpServerContext } from "./types"

type ManagerWithPrivateRetry = {
  getOrCreateClientWithRetry: (
    info: SkillMcpClientInfo,
    config: ClaudeCodeMcpServer,
    options?: SkillMcpClientOptionsLike
  ) => Promise<McpClient>
}

type SkillMcpClientOptionsLike = {
  cdpUrl?: string
  requestTimeoutMs?: number
}

function createInfo(): SkillMcpClientInfo {
  return {
    serverName: "timeout-server",
    skillName: "timeout-skill",
    sessionID: "session-1",
  }
}

function createContext(config: ClaudeCodeMcpServer): SkillMcpServerContext {
  return {
    skillName: "timeout-skill",
    config,
  }
}

function stubClient(manager: SkillMcpManager, client: McpClient): void {
  spyOn(unsafeTestValue<ManagerWithPrivateRetry>(manager), "getOrCreateClientWithRetry").mockResolvedValue(client)
}

describe("skill MCP request options", () => {
  describe("#resolveRequestTimeoutMs", () => {
    it("#given per-call override and server config #when resolving #then the per-call override wins", () => {
      // given
      const config: ClaudeCodeMcpServer = { url: "https://mcp.example.com/mcp", timeout: 120000 }

      // when
      const resolved = resolveRequestTimeoutMs(config, { requestTimeoutMs: 300000 })

      // then
      expect(resolved).toBe(300000)
    })

    it("#given only server config timeout #when resolving #then the config timeout is used", () => {
      // given
      const config: ClaudeCodeMcpServer = { command: "node", args: ["server.js"], timeout: 300000 }

      // when
      const resolved = resolveRequestTimeoutMs(config)

      // then
      expect(resolved).toBe(300000)
    })

    it("#given no timeout anywhere #when resolving #then undefined keeps the SDK default", () => {
      // given
      const config: ClaudeCodeMcpServer = { url: "https://mcp.example.com/mcp" }

      // when
      const resolved = resolveRequestTimeoutMs(config)

      // then
      expect(resolved).toBeUndefined()
    })
  })

  describe("#buildRequestOptions", () => {
    it("#given configured timeout #when building options #then SDK RequestOptions carry the timeout", () => {
      // given
      const config: ClaudeCodeMcpServer = { url: "https://mcp.example.com/mcp", timeout: 300000 }

      // when
      const requestOptions = buildRequestOptions(config)

      // then
      expect(requestOptions).toEqual({ timeout: 300000 })
    })

    it("#given unconfigured timeout #when building options #then undefined preserves SDK default behavior", () => {
      // given
      const config: ClaudeCodeMcpServer = { url: "https://mcp.example.com/mcp" }

      // when
      const requestOptions = buildRequestOptions(config)

      // then
      expect(requestOptions).toBeUndefined()
    })
  })

  describe("#SkillMcpManager propagation", () => {
    it("#given server config timeout #when callTool runs #then the SDK receives the timeout as request options", async () => {
      // given
      const manager = new SkillMcpManager()
      const callTool = mock<McpClient["callTool"]>(async () => ({ content: [] }))
      stubClient(
        manager,
        unsafeTestValue<McpClient>({
          callTool,
          close: mock(async () => {}),
        })
      )

      // when
      await manager.callTool(createInfo(), createContext({ url: "https://mcp.example.com/mcp", timeout: 300000 }), "test-tool", {})

      // then
      expect(callTool).toHaveBeenCalledTimes(1)
      expect(callTool.mock.calls[0][2]).toEqual({ timeout: 300000 })
    })

    it("#given unconfigured timeout #when callTool runs #then request options stay undefined so the SDK default applies", async () => {
      // given
      const manager = new SkillMcpManager()
      const callTool = mock<McpClient["callTool"]>(async () => ({ content: [] }))
      stubClient(
        manager,
        unsafeTestValue<McpClient>({
          callTool,
          close: mock(async () => {}),
        })
      )

      // when
      await manager.callTool(createInfo(), createContext({ url: "https://mcp.example.com/mcp" }), "test-tool", {})

      // then
      expect(callTool.mock.calls[0][2]).toBeUndefined()
    })

    it("#given per-call override #when callTool runs #then the override reaches the SDK instead of the config value", async () => {
      // given
      const manager = new SkillMcpManager()
      const callTool = mock<McpClient["callTool"]>(async () => ({ content: [] }))
      stubClient(
        manager,
        unsafeTestValue<McpClient>({
          callTool,
          close: mock(async () => {}),
        })
      )

      // when
      await manager.callTool(
        createInfo(),
        createContext({ url: "https://mcp.example.com/mcp", timeout: 120000 }),
        "test-tool",
        {},
        { requestTimeoutMs: 600000 }
      )

      // then
      expect(callTool.mock.calls[0][2]).toEqual({ timeout: 600000 })
    })

    it("#given server config timeout #when readResource runs #then the SDK receives the timeout as request options", async () => {
      // given
      const manager = new SkillMcpManager()
      const readResource = mock<McpClient["readResource"]>(async () => ({ contents: [] }))
      stubClient(
        manager,
        unsafeTestValue<McpClient>({
          readResource,
          close: mock(async () => {}),
        })
      )

      // when
      await manager.readResource(createInfo(), createContext({ url: "https://mcp.example.com/mcp", timeout: 300000 }), "memory://notes")

      // then
      expect(readResource.mock.calls[0][1]).toEqual({ timeout: 300000 })
    })

    it("#given server config timeout #when getPrompt runs #then the SDK receives the timeout as request options", async () => {
      // given
      const manager = new SkillMcpManager()
      const getPrompt = mock<McpClient["getPrompt"]>(async () => ({ messages: [] }))
      stubClient(
        manager,
        unsafeTestValue<McpClient>({
          getPrompt,
          close: mock(async () => {}),
        })
      )

      // when
      await manager.getPrompt(createInfo(), createContext({ url: "https://mcp.example.com/mcp", timeout: 300000 }), "summarize", {})

      // then
      expect(getPrompt.mock.calls[0][1]).toEqual({ timeout: 300000 })
    })

    it("#given server config timeout #when listTools runs #then the SDK receives the timeout as request options", async () => {
      // given
      const manager = new SkillMcpManager()
      const listTools = mock<McpClient["listTools"]>(async () => ({ tools: [] }))
      stubClient(
        manager,
        unsafeTestValue<McpClient>({
          listTools,
          close: mock(async () => {}),
        })
      )

      // when
      await manager.listTools(createInfo(), createContext({ url: "https://mcp.example.com/mcp", timeout: 300000 }))

      // then
      expect(listTools.mock.calls[0][1]).toEqual({ timeout: 300000 })
    })

    it("#given server config timeout #when listResources and listPrompts run #then the SDK receives the timeout as request options", async () => {
      // given
      const manager = new SkillMcpManager()
      const listResources = mock<McpClient["listResources"]>(async () => ({ resources: [] }))
      const listPrompts = mock<McpClient["listPrompts"]>(async () => ({ prompts: [] }))
      stubClient(
        manager,
        unsafeTestValue<McpClient>({
          listResources,
          listPrompts,
          close: mock(async () => {}),
        })
      )
      const context = createContext({ url: "https://mcp.example.com/mcp", timeout: 300000 })

      // when
      await manager.listResources(createInfo(), context)
      await manager.listPrompts(createInfo(), context)

      // then
      expect(listResources.mock.calls[0][1]).toEqual({ timeout: 300000 })
      expect(listPrompts.mock.calls[0][1]).toEqual({ timeout: 300000 })
    })
  })
})
