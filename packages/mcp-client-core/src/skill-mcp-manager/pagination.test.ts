import { expect, test } from "bun:test"
import { SkillMcpManager } from "./manager"

const catalogs = ["tools", "resources", "prompts"] as const

for (const catalog of catalogs) {
  for (const mode of ["single", "paged", "endless"] as const) {
    test(`${catalog}/list collects ${mode} catalogs through the MCP transport`, async () => {
      const cursors: (string | undefined)[] = []
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
          if (request.method !== "POST") return new Response(null, { status: 405 })
          const message = await request.json() as {
            id?: number
            method: string
            params?: { cursor?: string }
          }
          if (message.id === undefined) return new Response(null, { status: 202 })
          let result: unknown
          if (message.method === "initialize") {
            result = {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {}, resources: {}, prompts: {} },
              serverInfo: { name: "pagination-fixture", version: "1" },
            }
          } else {
            cursors.push(message.params?.cursor)
            const page = cursors.length
            const name = `item-${page}`
            const item = catalog === "tools" ? { name, inputSchema: { type: "object" } }
              : catalog === "resources" ? { name, uri: `fixture://${name}` }
                : { name }
            result = {
              [catalog]: mode === "single" ? [] : [item],
              ...(mode === "endless" || (mode === "paged" && page === 1)
                ? { nextCursor: "opaque /+= cursor" } : {}),
            }
          }
          return Response.json({ jsonrpc: "2.0", id: message.id, result })
        },
      })
      const manager = new SkillMcpManager()
      const info = { sessionID: "pagination", skillName: "fixture", serverName: "fixture" }
      const context = { skillName: "fixture", config: { url: `http://127.0.0.1:${server.port}/mcp` } }
      try {
        const result = catalog === "tools" ? manager.listTools(info, context)
          : catalog === "resources" ? manager.listResources(info, context)
            : manager.listPrompts(info, context)
        if (mode === "endless") {
          await expect(result).rejects.toThrow("100 pages")
          expect(cursors).toHaveLength(100)
        } else {
          expect((await result).map((item) => item.name)).toEqual(
            mode === "single" ? [] : ["item-1", "item-2"],
          )
          expect(cursors).toEqual(mode === "single" ? [undefined] : [undefined, "opaque /+= cursor"])
        }
      } finally {
        await manager.disconnectAll()
        await server.stop(true)
      }
    })
  }
}
