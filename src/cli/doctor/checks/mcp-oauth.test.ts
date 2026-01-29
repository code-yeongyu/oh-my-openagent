import { describe, it, expect, spyOn, afterEach } from "bun:test"
import * as mcpOauth from "./mcp-oauth"

describe("mcp-oauth check", () => {
  describe("getMcpOAuthCheckDefinition", () => {
    it("returns check definition with correct properties", () => {
      // #given
      // #when getting definition
      const def = mcpOauth.getMcpOAuthCheckDefinition()

      // #then should have correct structure
      expect(def.id).toBe("mcp-oauth-tokens")
      expect(def.name).toBe("MCP OAuth Tokens")
      expect(def.category).toBe("tools")
      expect(def.critical).toBe(false)
      expect(typeof def.check).toBe("function")
    })
  })

  describe("checkMcpOAuthTokens", () => {
    let readStoreSpy: ReturnType<typeof spyOn>

    afterEach(() => {
      readStoreSpy?.mockRestore()
    })

    it("returns skip when no tokens stored", async () => {
      // #given no OAuth tokens configured
      readStoreSpy = spyOn(mcpOauth, "readTokenStore").mockReturnValue(null)

      // #when checking OAuth tokens
      const result = await mcpOauth.checkMcpOAuthTokens()

      // #then should skip
      expect(result.status).toBe("skip")
      expect(result.message).toContain("No OAuth")
    })

    it("returns pass when all tokens valid", async () => {
      // #given valid tokens with future expiry (expiresAt is in epoch seconds)
      const futureTime = Math.floor(Date.now() / 1000) + 3600
      readStoreSpy = spyOn(mcpOauth, "readTokenStore").mockReturnValue({
        "example.com/resource1": {
          accessToken: "token1",
          expiresAt: futureTime,
        },
        "example.com/resource2": {
          accessToken: "token2",
          expiresAt: futureTime,
        },
      })

      // #when checking OAuth tokens
      const result = await mcpOauth.checkMcpOAuthTokens()

      // #then should pass
      expect(result.status).toBe("pass")
      expect(result.message).toContain("2")
      expect(result.message).toContain("valid")
    })

    it("returns warn when some tokens expired", async () => {
      // #given mix of valid and expired tokens (expiresAt is in epoch seconds)
      const futureTime = Math.floor(Date.now() / 1000) + 3600
      const pastTime = Math.floor(Date.now() / 1000) - 3600
      readStoreSpy = spyOn(mcpOauth, "readTokenStore").mockReturnValue({
        "example.com/resource1": {
          accessToken: "token1",
          expiresAt: futureTime,
        },
        "example.com/resource2": {
          accessToken: "token2",
          expiresAt: pastTime,
        },
      })

      // #when checking OAuth tokens
      const result = await mcpOauth.checkMcpOAuthTokens()

      // #then should warn
      expect(result.status).toBe("warn")
      expect(result.message).toContain("1")
      expect(result.message).toContain("expired")
      expect(result.details?.some((d: string) => d.includes("Expired"))).toBe(
        true
      )
    })

    it("returns pass when tokens have no expiry", async () => {
      // #given tokens without expiry info
      readStoreSpy = spyOn(mcpOauth, "readTokenStore").mockReturnValue({
        "example.com/resource1": {
          accessToken: "token1",
        },
      })

      // #when checking OAuth tokens
      const result = await mcpOauth.checkMcpOAuthTokens()

      // #then should pass (no expiry = assume valid)
      expect(result.status).toBe("pass")
      expect(result.message).toContain("1")
    })

    it("includes token details in output", async () => {
      // #given multiple tokens
      const futureTime = Math.floor(Date.now() / 1000) + 3600
      readStoreSpy = spyOn(mcpOauth, "readTokenStore").mockReturnValue({
        "api.example.com/v1": {
          accessToken: "token1",
          expiresAt: futureTime,
        },
        "auth.example.com/oauth": {
          accessToken: "token2",
          expiresAt: futureTime,
        },
      })

      // #when checking OAuth tokens
      const result = await mcpOauth.checkMcpOAuthTokens()

      // #then should list tokens in details
      expect(result.details).toBeDefined()
      expect(result.details?.length).toBeGreaterThan(0)
      expect(
        result.details?.some((d: string) => d.includes("api.example.com"))
      ).toBe(true)
      expect(
        result.details?.some((d: string) => d.includes("auth.example.com"))
      ).toBe(true)
    })
  })
})
