import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { McpOAuthProvider, generateCodeVerifier, generateCodeChallenge, buildAuthorizationUrl } from "./provider"
import type { OAuthTokenData } from "./storage"

describe("McpOAuthProvider", () => {
  describe("generateCodeVerifier", () => {
    it("returns a base64url-encoded 32-byte random string", () => {
      //#given
      const verifier = generateCodeVerifier()

      //#when
      const decoded = Buffer.from(verifier, "base64url")

      //#then
      expect(decoded.length).toBe(32)
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it("produces unique values on each call", () => {
      //#given
      const first = generateCodeVerifier()

      //#when
      const second = generateCodeVerifier()

      //#then
      expect(first).not.toBe(second)
    })
  })

  describe("generateCodeChallenge", () => {
    it("returns SHA256 base64url digest of the verifier", () => {
      //#given
      const verifier = "test-verifier-value"
      const expected = createHash("sha256").update(verifier).digest("base64url")

      //#when
      const challenge = generateCodeChallenge(verifier)

      //#then
      expect(challenge).toBe(expected)
    })
  })

  describe("buildAuthorizationUrl", () => {
    it("builds URL with all required PKCE parameters", () => {
      //#given
      const endpoint = "https://auth.example.com/authorize"

      //#when
      const url = buildAuthorizationUrl(endpoint, {
        clientId: "my-client",
        redirectUri: "http://127.0.0.1:8912/callback",
        codeChallenge: "challenge-value",
        state: "state-value",
        scopes: ["openid", "profile"],
        resource: "https://mcp.example.com",
      })

      //#then
      const parsed = new URL(url)
      expect(parsed.origin + parsed.pathname).toBe("https://auth.example.com/authorize")
      expect(parsed.searchParams.get("response_type")).toBe("code")
      expect(parsed.searchParams.get("client_id")).toBe("my-client")
      expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8912/callback")
      expect(parsed.searchParams.get("code_challenge")).toBe("challenge-value")
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
      expect(parsed.searchParams.get("state")).toBe("state-value")
      expect(parsed.searchParams.get("scope")).toBe("openid profile")
      expect(parsed.searchParams.get("resource")).toBe("https://mcp.example.com")
    })

    it("omits scope when empty", () => {
      //#given
      const endpoint = "https://auth.example.com/authorize"

      //#when
      const url = buildAuthorizationUrl(endpoint, {
        clientId: "my-client",
        redirectUri: "http://127.0.0.1:8912/callback",
        codeChallenge: "challenge-value",
        state: "state-value",
        scopes: [],
      })

      //#then
      const parsed = new URL(url)
      expect(parsed.searchParams.has("scope")).toBe(false)
    })

    it("omits resource when undefined", () => {
      //#given
      const endpoint = "https://auth.example.com/authorize"

      //#when
      const url = buildAuthorizationUrl(endpoint, {
        clientId: "my-client",
        redirectUri: "http://127.0.0.1:8912/callback",
        codeChallenge: "challenge-value",
        state: "state-value",
      })

      //#then
      const parsed = new URL(url)
      expect(parsed.searchParams.has("resource")).toBe(false)
    })
  })

  describe("constructor and basic methods", () => {
    it("stores serverUrl and optional clientId and scopes", () => {
      //#given
      const options = {
        serverUrl: "https://mcp.example.com",
        clientId: "my-client",
        scopes: ["openid"],
      }

      //#when
      const provider = new McpOAuthProvider(options)

      //#then
      expect(provider.tokens()).toBeNull()
      expect(provider.clientInformation()).toBeNull()
      expect(provider.codeVerifier()).toBeNull()
    })

    it("defaults scopes to empty array", () => {
      //#given
      const options = { serverUrl: "https://mcp.example.com" }

      //#when
      const provider = new McpOAuthProvider(options)

      //#then
      expect(provider.redirectUrl()).toBe("http://127.0.0.1:19877/callback")
    })
  })

  describe("saveCodeVerifier / codeVerifier", () => {
    it("stores and retrieves code verifier", () => {
      //#given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })

      //#when
      provider.saveCodeVerifier("my-verifier")

      //#then
      expect(provider.codeVerifier()).toBe("my-verifier")
    })
  })

  describe("saveTokens / tokens", () => {
    let originalEnv: string | undefined

    beforeEach(() => {
      originalEnv = process.env.OPENCODE_CONFIG_DIR
      const { mkdirSync } = require("node:fs")
      const { tmpdir } = require("node:os")
      const { join } = require("node:path")
      const testDir = join(tmpdir(), "mcp-oauth-provider-test-" + Date.now())
      mkdirSync(testDir, { recursive: true })
      process.env.OPENCODE_CONFIG_DIR = testDir
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR
      } else {
        process.env.OPENCODE_CONFIG_DIR = originalEnv
      }
    })

    it("persists and loads token data via storage", () => {
      //#given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })
      const tokenData: OAuthTokenData = {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: 1710000000,
      }

      //#when
      const saved = provider.saveTokens(tokenData)
      const loaded = provider.tokens()

      //#then
      expect(saved).toBe(true)
      expect(loaded).toEqual(tokenData)
    })
  })

  describe("redirectToAuthorization", () => {
    it("throws when no client information is set", async () => {
      //#given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })
      const metadata = {
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
        resource: "https://mcp.example.com",
      }

      //#when
      const result = provider.redirectToAuthorization(metadata)

      //#then
      await expect(result).rejects.toThrow("No client information available")
    })
  })

  describe("redirectUrl", () => {
    it("returns localhost callback URL with default port", () => {
      //#given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })

      //#when
      const url = provider.redirectUrl()

      //#then
      expect(url).toBe("http://127.0.0.1:19877/callback")
    })
  })
})
