import { expect, test } from "bun:test"
import { SkillMcpManager } from "./manager"

test("default skill HTTP client sends modern routing headers and terminates input-required operations", async () => {
  const requests: { method: string; headers: Headers; params?: Record<string, unknown> }[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const message = await request.json() as {
        id: number | string; method: string; params?: Record<string, unknown>
      }
      requests.push({ ...message, headers: request.headers })
      const result = message.method === "server/discover"
        ? { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {} } }
        : message.method === "tools/list"
          ? { resultType: "complete", tools: [] }
          : message.method === "resources/read"
            ? { resultType: "complete", contents: [] }
          : { resultType: "input_required", inputRequests: {}, requestState: "opaque" }
      return Response.json({ jsonrpc: "2.0", id: message.id, result })
    },
  })
  const manager = new SkillMcpManager()
  const info = { serverName: "modern", skillName: "test", sessionID: "http" }
  const context = { skillName: "test", config: { url: server.url.href } }
  try {
    expect(await manager.listTools(info, context)).toEqual([])
    expect(await manager.readResource(info, context, "file:///example")).toEqual([])
    await expect(manager.callTool(info, context, " \uC774\uB984 ", {})).rejects.toThrow("operation was terminated")
    expect(requests.map((request) => request.method)).toEqual(["server/discover", "tools/list", "resources/read", "tools/call"])
    for (const request of requests) {
      expect(request.headers.get("MCP-Protocol-Version")).toBe("2026-07-28")
      expect(request.headers.get("Mcp-Method")).toBe(request.method)
      expect(request.headers.has("Mcp-Session-Id")).toBe(false)
      expect(request.params?._meta).toMatchObject({
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "skill-mcp-test-modern", version: "1.0.0" },
      })
    }
    expect(requests[2]?.headers.get("Mcp-Name")).toBe("file:///example")
    expect(requests[3]?.headers.get("Mcp-Name")).toBe(`=?base64?${Buffer.from(" \uC774\uB984 ").toString("base64")}?=`)
  } finally {
    await manager.disconnectAll()
    await server.stop(true)
  }
})

test("HTTP 400 UnsupportedProtocolVersion falls back to legacy initialization", async () => {
  const methods: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === "GET") return new Response(null, { status: 405 })
      const message = await request.json() as {
        id: number | string; method: string; params?: { _meta?: Record<string, unknown> }
      }
      methods.push(message.method)
      if (message.method === "notifications/initialized") return new Response(null, { status: 202 })
      if (message.method === "server/discover") {
        return Response.json({ jsonrpc: "2.0", id: message.id, result: {
          resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} },
        } })
      }
      if (message.params?._meta) {
        return Response.json({ jsonrpc: "2.0", id: message.id,
          error: { code: -32022, message: "Unsupported protocol version", data: { supported: ["2025-03-26"] } },
        }, { status: 400 })
      }
      const result = message.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1" } }
        : { tools: [] }
      return Response.json({ jsonrpc: "2.0", id: message.id, result })
    },
  })
  const manager = new SkillMcpManager()
  try {
    expect(await manager.listTools(
      { serverName: "fallback", skillName: "test", sessionID: "http" },
      { skillName: "test", config: { url: server.url.href } },
    )).toEqual([])
    expect(methods).toEqual(["server/discover", "tools/list", "initialize", "notifications/initialized", "tools/list"])
  } finally {
    await manager.disconnectAll()
    await server.stop(true)
  }
})
