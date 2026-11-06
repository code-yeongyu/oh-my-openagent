import { describe, expect, it, spyOn } from "bun:test"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { SkillMcpManager, type SkillMcpClientOptions } from "./manager"
import { buildRequestOptions, resolveRequestTimeoutMs } from "./request-options"
import type { McpClient, SkillMcpClientInfo } from "./types"

const info: SkillMcpClientInfo = { serverName: "timeout-server", skillName: "timeout-skill", sessionID: "session-1" }
const remote = (timeout?: number): ClaudeCodeMcpServer =>
  timeout === undefined ? { url: "https://mcp.example.com/mcp" } : { url: "https://mcp.example.com/mcp", timeout }

describe("#resolveRequestTimeoutMs", () => {
  it("uses the server's configured timeout, else the SDK default", () => {
    expect(resolveRequestTimeoutMs(remote(120_000))).toBe(120_000)
    expect(resolveRequestTimeoutMs(remote(2_147_483_647))).toBe(2_147_483_647)
    expect(resolveRequestTimeoutMs(remote())).toBeUndefined()
  })

  it("ignores values that would arm an immediate or never-firing timer (#7224 review)", () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 3_000_000_000]) {
      expect(resolveRequestTimeoutMs(remote(invalid)), String(invalid)).toBeUndefined()
    }
  })
})

describe("#buildRequestOptions", () => {
  it("carries the abort signal and the timeout together, and nothing when neither is set", () => {
    const controller = new AbortController()
    expect(buildRequestOptions(remote(5_000), { signal: controller.signal })).toStrictEqual({ signal: controller.signal, timeout: 5_000 })
    expect(buildRequestOptions(remote())).toStrictEqual({})
    expect(buildRequestOptions(remote(0), {})).toStrictEqual({})
  })
})

describe("SkillMcpManager request options", () => {
  type Captured = { op: string; options: unknown }
  const recordingClient = (captured: Captured[]) => unsafeTestValue<McpClient>({
    listTools: async (_params: unknown, options: unknown) => { captured.push({ op: "listTools", options }); return { tools: [] } },
    listResources: async (_params: unknown, options: unknown) => { captured.push({ op: "listResources", options }); return { resources: [] } },
    listPrompts: async (_params: unknown, options: unknown) => { captured.push({ op: "listPrompts", options }); return { prompts: [] } },
    callTool: async (_params: unknown, _schema: unknown, options: unknown) => { captured.push({ op: "callTool", options }); return { content: [] } },
    readResource: async (_params: unknown, options: unknown) => { captured.push({ op: "readResource", options }); return { contents: [] } },
    getPrompt: async (_params: unknown, options: unknown) => { captured.push({ op: "getPrompt", options }); return { messages: [] } },
  })

  it("passes the configured timeout to every direct MCP operation", async () => {
    const captured: Captured[] = []
    const manager = new SkillMcpManager()
    spyOn(unsafeTestValue<{ getOrCreateClientWithRetry: () => Promise<McpClient> }>(manager), "getOrCreateClientWithRetry")
      .mockResolvedValue(recordingClient(captured))
    const context = { skillName: "timeout-skill", config: remote(45_000) }
    const options: SkillMcpClientOptions = { signal: new AbortController().signal }

    await manager.listTools(info, context)
    await manager.listResources(info, context)
    await manager.listPrompts(info, context)
    await manager.callTool(info, context, "echo", {}, options)
    await manager.readResource(info, context, "file:///x")
    await manager.getPrompt(info, context, "greet", {})

    expect(captured).toStrictEqual([
      { op: "listTools", options: { timeout: 45_000 } },
      { op: "listResources", options: { timeout: 45_000 } },
      { op: "listPrompts", options: { timeout: 45_000 } },
      { op: "callTool", options: { signal: options.signal, timeout: 45_000 } },
      { op: "readResource", options: { timeout: 45_000 } },
      { op: "getPrompt", options: { timeout: 45_000 } },
    ])
  })

  it("times out a tool call against a server that never answers, at the configured timeout", async () => {
    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      async fetch(request) {
        if (request.method === "GET") return new Response(null, { status: 405 })
        const message = await request.json() as { id?: number | string; method: string }
        if (message.method === "server/discover") {
          return Response.json({ jsonrpc: "2.0", id: message.id, result: {
            resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} },
          } })
        }
        if (message.method !== "tools/call") return new Response(null, { status: 202 })
        return new Promise<Response>(() => {})
      },
    })
    const manager = new SkillMcpManager()
    try {
      const started = performance.now()
      const outcome = await manager.callTool(
        { ...info, sessionID: "timeout-live" },
        { skillName: "timeout-skill", config: { url: server.url.href, timeout: 300 } },
        "never_answers",
        {},
      ).then(() => "resolved", (error: unknown) => error)
      expect(outcome).toBeInstanceOf(McpError)
      expect(unsafeTestValue<McpError>(outcome).code).toBe(ErrorCode.RequestTimeout)
      expect(performance.now() - started).toBeLessThan(10_000)
    } finally {
      await manager.disconnectAll()
      await server.stop(true)
    }
  })
})
