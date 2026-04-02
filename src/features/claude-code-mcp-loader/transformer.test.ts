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

  describe("#given a server config containing sensitive env references", () => {
    it("#when transforming a local MCP server #then it strips sensitive env vars from the environment", () => {
      // given
      process.env.GITHUB_TOKEN = "ghp-secret"
      process.env.HOME = "/Users/tester"

      // when
      const transformed = transformMcpServer("local-secure", {
        command: "npx",
        args: ["mcp-server", "${HOME}"],
        env: {
          HOME_DIR: "${HOME}",
          AUTH_TOKEN: "${GITHUB_TOKEN}",
        },
      })

      // then
      expect(transformed).toEqual({
        type: "local",
        command: ["npx", "mcp-server", "/Users/tester"],
        environment: {
          HOME_DIR: "/Users/tester",
          AUTH_TOKEN: "",
        },
        enabled: true,
      })
    })

    it("#when transforming a remote MCP server #then it strips sensitive env vars from the url", () => {
      // given
      process.env.API_KEY = "secret-key"

      // when
      const transformed = transformMcpServer("remote-secure", {
        type: "http",
        url: "https://mcp.example.com/${API_KEY}",
      })

      // then
      expect(transformed).toEqual({
        type: "remote",
        url: "https://mcp.example.com/",
        enabled: true,
      })
    })
  })
})
