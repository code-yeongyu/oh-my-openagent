import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import * as connectionModule from "./connection"
import { SkillMcpManager } from "./manager"
import { resolveMcpRequestOptions } from "./request-timeouts"
import type { McpClient, SkillMcpClientInfo, SkillMcpServerContext } from "./types"

function createRecordingClient() {
  return {
    connect: mock(async () => {}),
    close: mock(async () => {}),
    listTools: mock(async (_params?: unknown, _options?: RequestOptions) => ({ tools: [] })),
    listResources: mock(async (_params?: unknown, _options?: RequestOptions) => ({ resources: [] })),
    listPrompts: mock(async (_params?: unknown, _options?: RequestOptions) => ({ prompts: [] })),
    callTool: mock(async (_params?: unknown, _resultSchema?: unknown, _options?: RequestOptions) => ({
      content: [],
    })),
    readResource: mock(async (_params?: unknown, _options?: RequestOptions) => ({ contents: [] })),
    getPrompt: mock(async (_params?: unknown, _options?: RequestOptions) => ({ messages: [] })),
  }
}

const info: SkillMcpClientInfo = {
  serverName: "slow-server",
  skillName: "slow-skill",
  sessionID: "session-1",
}

describe("resolveMcpRequestOptions", () => {
  it("#given no timeout config #when resolving #then returns undefined so the SDK default applies", () => {
    // given
    const serverTimeouts = undefined

    // when
    const resolved = resolveMcpRequestOptions(serverTimeouts)

    // then
    expect(resolved).toBeUndefined()
  })

  it("#given per-server timeouts #when resolving #then they map onto the SDK request option names", () => {
    // given
    const serverTimeouts = {
      requestTimeoutMs: 120_000,
      maxTotalTimeoutMs: 600_000,
      resetTimeoutOnProgress: true,
    }

    // when
    const resolved = resolveMcpRequestOptions(serverTimeouts)

    // then
    expect(resolved).toEqual({
      timeout: 120_000,
      maxTotalTimeout: 600_000,
      resetTimeoutOnProgress: true,
    })
  })

  it("#given a per-call override #when resolving #then it wins field by field over the server config", () => {
    // given
    const serverTimeouts = { requestTimeoutMs: 120_000, maxTotalTimeoutMs: 600_000 }
    const callTimeouts = { requestTimeoutMs: 300_000 }

    // when
    const resolved = resolveMcpRequestOptions(serverTimeouts, callTimeouts)

    // then
    expect(resolved).toEqual({ timeout: 300_000, maxTotalTimeout: 600_000 })
  })

  it("#given non-positive or non-finite timeouts #when resolving #then they are dropped instead of forwarded", () => {
    // given
    const serverTimeouts = { requestTimeoutMs: 0, maxTotalTimeoutMs: Number.NaN }
    const callTimeouts = { requestTimeoutMs: -1 }

    // when
    const resolved = resolveMcpRequestOptions(serverTimeouts, callTimeouts)

    // then
    expect(resolved).toBeUndefined()
  })

  it("#given only resetTimeoutOnProgress set to false #when resolving #then the flag is still forwarded", () => {
    // given
    const serverTimeouts = { resetTimeoutOnProgress: false }

    // when
    const resolved = resolveMcpRequestOptions(serverTimeouts)

    // then
    expect(resolved).toEqual({ resetTimeoutOnProgress: false })
  })
})

describe("SkillMcpManager request option propagation", () => {
  afterEach(() => {
    spyOn(connectionModule, "getOrCreateClientWithRetryImpl").mockRestore()
  })

  function stubClient(client: ReturnType<typeof createRecordingClient>) {
    spyOn(connectionModule, "getOrCreateClientWithRetryImpl").mockImplementation(
      async () => client as unknown as McpClient,
    )
  }

  it("#given a server with configured timeouts #when driving every operation #then each SDK call receives the request options", async () => {
    // given
    const client = createRecordingClient()
    stubClient(client)
    const config: ClaudeCodeMcpServer = {
      command: "node",
      args: ["slow-server.js"],
      timeouts: { requestTimeoutMs: 120_000, resetTimeoutOnProgress: true },
    }
    const context: SkillMcpServerContext = { config, skillName: "slow-skill" }
    const expected = { timeout: 120_000, resetTimeoutOnProgress: true }
    const manager = new SkillMcpManager()

    // when
    await manager.listTools(info, context)
    await manager.listResources(info, context)
    await manager.listPrompts(info, context)
    await manager.callTool(info, context, "wait", { seconds: 65 })
    await manager.readResource(info, context, "file:///report.txt")
    await manager.getPrompt(info, context, "summarize", {})

    // then
    expect(client.listTools.mock.calls[0]?.[1]).toEqual(expected)
    expect(client.listResources.mock.calls[0]?.[1]).toEqual(expected)
    expect(client.listPrompts.mock.calls[0]?.[1]).toEqual(expected)
    expect(client.callTool.mock.calls[0]?.[2]).toEqual(expected)
    expect(client.readResource.mock.calls[0]?.[1]).toEqual(expected)
    expect(client.getPrompt.mock.calls[0]?.[1]).toEqual(expected)
  })

  it("#given a per-call timeout override #when calling a tool #then the override reaches the SDK", async () => {
    // given
    const client = createRecordingClient()
    stubClient(client)
    const config: ClaudeCodeMcpServer = {
      command: "node",
      args: ["slow-server.js"],
      timeouts: { requestTimeoutMs: 120_000 },
    }
    const context: SkillMcpServerContext = { config, skillName: "slow-skill" }
    const manager = new SkillMcpManager()

    // when
    await manager.callTool(info, context, "wait", { seconds: 65 }, { timeouts: { requestTimeoutMs: 300_000 } })

    // then
    expect(client.callTool.mock.calls[0]?.[2]).toEqual({ timeout: 300_000 })
  })

  it("#given a server without timeout config #when calling a tool #then no request options are sent and the SDK default stands", async () => {
    // given
    const client = createRecordingClient()
    stubClient(client)
    const config: ClaudeCodeMcpServer = { command: "node", args: ["server.js"] }
    const context: SkillMcpServerContext = { config, skillName: "slow-skill" }
    const manager = new SkillMcpManager()

    // when
    await manager.callTool(info, context, "wait", {})

    // then
    expect(client.callTool.mock.calls[0]?.[2]).toBeUndefined()
  })
})
