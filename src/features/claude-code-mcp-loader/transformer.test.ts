import { describe, it, expect } from "bun:test"
import { transformMcpServer } from "./transformer"

describe("transformMcpServer", () => {
  describe("local (stdio) servers", () => {
    it("transforms basic stdio server", () => {
      // #given
      const server = {
        command: "npx",
        args: ["@playwright/mcp@latest"],
      }

      // #when
      const result = transformMcpServer("playwright", server)

      // #then
      expect(result.type).toBe("local")
      expect(result).toHaveProperty("command", ["npx", "@playwright/mcp@latest"])
      expect(result.enabled).toBe(true)
    })

    it("includes timeout when specified", () => {
      // #given
      const server = {
        command: "npx",
        args: ["-y", "agent-arena"],
        timeout: 600000,
      }

      // #when
      const result = transformMcpServer("arena", server)

      // #then
      expect(result.type).toBe("local")
      expect(result).toHaveProperty("timeout", 600000)
    })

    it("includes environment variables", () => {
      // #given
      const server = {
        command: "npx",
        args: ["some-mcp"],
        env: { API_KEY: "secret" },
      }

      // #when
      const result = transformMcpServer("test", server)

      // #then
      expect(result.type).toBe("local")
      expect(result).toHaveProperty("environment", { API_KEY: "secret" })
    })

    it("does not include timeout when not specified", () => {
      // #given
      const server = {
        command: "npx",
        args: ["some-mcp"],
      }

      // #when
      const result = transformMcpServer("test", server)

      // #then
      expect(result).not.toHaveProperty("timeout")
    })
  })

  describe("remote (http/sse) servers", () => {
    it("transforms http server", () => {
      // #given
      const server = {
        type: "http" as const,
        url: "https://mcp.example.com",
      }

      // #when
      const result = transformMcpServer("remote", server)

      // #then
      expect(result.type).toBe("remote")
      expect(result).toHaveProperty("url", "https://mcp.example.com")
      expect(result.enabled).toBe(true)
    })

    it("transforms sse server", () => {
      // #given
      const server = {
        type: "sse" as const,
        url: "https://mcp.example.com/sse",
      }

      // #when
      const result = transformMcpServer("remote-sse", server)

      // #then
      expect(result.type).toBe("remote")
      expect(result).toHaveProperty("url", "https://mcp.example.com/sse")
    })

    it("includes headers when specified", () => {
      // #given
      const server = {
        type: "http" as const,
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer token" },
      }

      // #when
      const result = transformMcpServer("remote", server)

      // #then
      expect(result).toHaveProperty("headers", { Authorization: "Bearer token" })
    })

    it("includes timeout when specified", () => {
      // #given
      const server = {
        type: "http" as const,
        url: "https://mcp.example.com",
        timeout: 120000,
      }

      // #when
      const result = transformMcpServer("remote", server)

      // #then
      expect(result.type).toBe("remote")
      expect(result).toHaveProperty("timeout", 120000)
    })

    it("does not include timeout when not specified", () => {
      // #given
      const server = {
        type: "http" as const,
        url: "https://mcp.example.com",
      }

      // #when
      const result = transformMcpServer("remote", server)

      // #then
      expect(result).not.toHaveProperty("timeout")
    })
  })

  describe("error handling", () => {
    it("throws error when http server has no url", () => {
      // #given
      const server = {
        type: "http" as const,
      }

      // #when & #then
      expect(() => transformMcpServer("broken", server)).toThrow(
        'MCP server "broken" requires url for type "http"'
      )
    })

    it("throws error when stdio server has no command", () => {
      // #given
      const server = {
        type: "stdio" as const,
      }

      // #when & #then
      expect(() => transformMcpServer("broken", server)).toThrow(
        'MCP server "broken" requires command for stdio type'
      )
    })
  })
})
