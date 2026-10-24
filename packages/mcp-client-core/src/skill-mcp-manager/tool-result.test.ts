import { expect, test } from "bun:test"
import { SkillMcpManager } from "./manager"

test("callTool preserves the server result envelope without retrying tool failures", async () => {
  let calls = 0
  const expected = {
    content: [{ type: "text" as const, text: "Not connected: synthetic failure" }],
    isError: true,
    structuredContent: { code: "fixture-failure" },
    _meta: { fixture: true },
  }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const message = await request.json() as { id?: number; method: string }
      if (message.id === undefined) return new Response(null, { status: 202 })
      if (message.method === "tools/call") calls++
      const result = message.method === "initialize" ? {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "result-fixture", version: "1" },
      } : expected
      return Response.json({ jsonrpc: "2.0", id: message.id, result })
    },
  })
  const manager = new SkillMcpManager()
  try {
    expect(await manager.callTool(
      { sessionID: "result", skillName: "fixture", serverName: "fixture" },
      { skillName: "fixture", config: { url: `http://127.0.0.1:${server.port}/mcp` } },
      "fail", {},
    )).toEqual(expected)
    expect(calls).toBe(1)
  } finally {
    await manager.disconnectAll()
    await server.stop(true)
  }
})
