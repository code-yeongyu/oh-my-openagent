import { describe, expect, it } from "bun:test"
import { transformMcpServer } from "./transformer"

describe("transformMcpServer", () => {
  describe("#given a remote MCP server with oauth config", () => {
    it("#when transforming the server #then preserves oauth on the remote config", () => {
      const transformed = transformMcpServer("remote-oauth", {
        type: "http",
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer test" },
        oauth: {
          clientId: "client-id",
          scopes: ["read", "write"],
        },
      })

      expect(transformed).toEqual({
        type: "remote",
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer test" },
        oauth: {
          clientId: "client-id",
          scopes: ["read", "write"],
        },
        enabled: true,
      })
    })
  })
})
