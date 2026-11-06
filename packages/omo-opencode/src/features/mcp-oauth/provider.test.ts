import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OAuthTokenData } from "./storage"
import { resetDiscoveryCache } from "./discovery"

type ProviderModule = typeof import("./provider")

async function importFreshProviderModule(): Promise<ProviderModule> {
  return await import(new URL(`./provider.ts?real-provider-test=${Date.now()}-${Math.random()}`, import.meta.url).href)
}

describe("McpOAuthProvider", () => {
  let McpOAuthProvider: ProviderModule["McpOAuthProvider"]
  let originalConfigDir: string | undefined
  let testConfigDir: string | null = null

  beforeEach(async () => {
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    testConfigDir = mkdtempSync(join(tmpdir(), "mcp-oauth-provider-test-"))
    process.env.OPENCODE_CONFIG_DIR = testConfigDir

    const providerModule = await importFreshProviderModule()
    McpOAuthProvider = providerModule.McpOAuthProvider
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    }

    if (testConfigDir) {
      rmSync(testConfigDir, { recursive: true, force: true })
      testConfigDir = null
    }
  })

  describe("constructor and basic methods", () => {
    it("stores serverUrl and optional clientId and scopes", () => {
      // given
      const options = {
        serverUrl: "https://mcp.example.com",
        clientId: "my-client",
        scopes: ["openid"],
      }

      // when
      const provider = new McpOAuthProvider(options)

      // then
      expect(provider.tokens()).toBeNull()
      expect(provider.clientInformation()).toBeNull()
      expect(provider.codeVerifier()).toBeNull()
    })

    it("defaults scopes to empty array", () => {
      // given
      const options = { serverUrl: "https://mcp.example.com" }

      // when
      const provider = new McpOAuthProvider(options)

      // then
      expect(provider.redirectUrl()).toBe("http://127.0.0.1:19877/callback")
    })
  })

  describe("saveCodeVerifier / codeVerifier", () => {
    it("stores and retrieves code verifier", () => {
      // given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })

      // when
      provider.saveCodeVerifier("my-verifier")

      // then
      expect(provider.codeVerifier()).toBe("my-verifier")
    })
  })

  describe("saveTokens / tokens", () => {
    it("persists and loads token data via storage", () => {
      // given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })
      const tokenData: OAuthTokenData = {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresAt: 1710000000,
      }

      // when
      const saved = provider.saveTokens(tokenData)
      const loaded = provider.tokens()

      // then
      expect(saved).toBe(true)
      expect(loaded).toEqual(tokenData)
    })
  })

  describe("redirectToAuthorization", () => {
    it("throws when no client information is set", async () => {
      // given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })
      const metadata = {
        issuer: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
        resource: "https://mcp.example.com",
      }

      // when
      const result = provider.redirectToAuthorization(metadata)

      // then
      await expect(result).rejects.toThrow("No client information available")
    })
  })

  describe("refresh", () => {
    let originalFetch: typeof globalThis.fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
      resetDiscoveryCache()
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
      resetDiscoveryCache()
    })

    it("exchanges refresh token and preserves it when the response omits a new one", async () => {
      // Stub fetch to handle both discovery (well-known) and token exchange
      const fetchStub = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString()
        if (url.includes("oauth-protected-resource")) {
          // PRM: return authorization_servers pointing to auth server
          return new Response(
            JSON.stringify({ authorization_servers: ["https://auth.example.com"] }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.includes(".well-known")) {
          // AS metadata
          return new Response(
            JSON.stringify({
              issuer: "https://auth.example.com",
              authorization_endpoint: "https://auth.example.com/authorize",
              token_endpoint: "https://auth.example.com/token",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        // Token exchange
        const body = init?.body?.toString() ?? ""
        expect(body).toContain("grant_type=refresh_token")
        expect(body).toContain("refresh_token=refresh-token-456")
        expect(body).toContain("client_id=my-client")
        return new Response(
          JSON.stringify({ access_token: "refreshed-access-token", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      })
      const fetchMock = (async (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        fetchStub(...args)) satisfies typeof fetch
      globalThis.fetch = fetchMock

      // given
      const providerModule = await importFreshProviderModule()
      const provider = new providerModule.McpOAuthProvider({
        serverUrl: "https://mcp.example.com",
        clientId: "my-client",
      })
      provider.saveTokens({
        accessToken: "old-access-token",
        refreshToken: "refresh-token-456",
        expiresAt: Math.floor(Date.now() / 1000) - 60,
        clientInfo: { clientId: "my-client" },
      })

      // when
      const result = await provider.refresh("refresh-token-456")

      // then
      expect(result.accessToken).toBe("refreshed-access-token")
      expect(result.refreshToken).toBe("refresh-token-456") // preserved from input when absent in response
    })

    it("propagates non-Error token error-body parse failures", async () => {
      // given
      const nonErrorFailure = Object.freeze({ reason: "non-error json failure" })
      const fetchStub = mock(async (input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.includes("oauth-protected-resource")) {
          return new Response(
            JSON.stringify({ authorization_servers: ["https://auth.example.com"] }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.includes(".well-known")) {
          return new Response(
            JSON.stringify({
              issuer: "https://auth.example.com",
              authorization_endpoint: "https://auth.example.com/authorize",
              token_endpoint: "https://auth.example.com/token",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }

        const tokenResponse = new Response("", { status: 400 })
        Object.defineProperty(tokenResponse, "json", {
          value: async () => {
            throw nonErrorFailure
          },
        })
        return tokenResponse
      })
      const fetchMock = (async (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
        fetchStub(...args)) satisfies typeof fetch
      globalThis.fetch = fetchMock
      const providerModule = await importFreshProviderModule()
      const provider = new providerModule.McpOAuthProvider({
        serverUrl: "https://mcp.example.com",
        clientId: "my-client",
      })
      provider.saveTokens({
        accessToken: "old-access-token",
        refreshToken: "refresh-token-456",
        expiresAt: Math.floor(Date.now() / 1000) - 60,
        clientInfo: { clientId: "my-client" },
      })

      // when
      const result = provider.refresh("refresh-token-456")

      // then
      await expect(result).rejects.toBe(nonErrorFailure)
    })
  })

  describe("redirectUrl", () => {
    it("returns localhost callback URL with default port", () => {
      // given
      const provider = new McpOAuthProvider({ serverUrl: "https://mcp.example.com" })

      // when
      const url = provider.redirectUrl()

      // then
      expect(url).toBe("http://127.0.0.1:19877/callback")
    })
  })
})
