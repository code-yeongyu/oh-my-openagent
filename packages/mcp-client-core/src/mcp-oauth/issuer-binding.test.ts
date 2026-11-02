import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetDiscoveryCache } from "./discovery"
import type { OAuthServerMetadata } from "./discovery"
import { McpOAuthProvider } from "./provider"
import { loadToken, saveToken } from "./storage"
import { buildHttpRequestInit, handlePostRequestAuthError } from "../skill-mcp-manager/oauth-handler"

const resource = "https://resource.example.com/mcp"
const firstIssuer = "https://auth.example.com:8443/tenant"
const originalFetch = globalThis.fetch
const originalConfigDir = process.env.OPENCODE_CONFIG_DIR
let directory: string
let selectedIssuer: string
let registrationAvailable: boolean
let rejectRegistration: boolean
let registrations: number
let requests: { url: string; body: string }[]

// Exercise the real login/refresh/storage path without opening the user's browser.
class RedirectProvider extends McpOAuthProvider {
  override async redirectToAuthorization(_metadata: OAuthServerMetadata): Promise<{ code: string }> {
    this.saveCodeVerifier("synthetic-verifier")
    return { code: "synthetic-code" }
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "oauth-issuer-binding-"))
  process.env.OPENCODE_CONFIG_DIR = directory
  selectedIssuer = firstIssuer
  registrationAvailable = true
  rejectRegistration = false
  registrations = 0
  requests = []
  resetDiscoveryCache()
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.includes("oauth-protected-resource")) {
        return Response.json({ authorization_servers: [selectedIssuer] })
      }
      if (url.includes(".well-known")) {
        return Response.json({
          issuer: selectedIssuer,
          authorization_endpoint: `${selectedIssuer}/authorize`,
          token_endpoint: `${selectedIssuer}/token`,
          ...(registrationAvailable ? { registration_endpoint: `${selectedIssuer}/register` } : {}),
        })
      }
      requests.push({ url, body: init?.body?.toString() ?? "" })
      if (url.endsWith("/register")) {
        registrations++
        return rejectRegistration
          ? new Response("", { status: 400 })
          : Response.json({ client_id: `registered-${registrations}` })
      }
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh" })
    },
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
  rmSync(directory, { recursive: true, force: true })
  resetDiscoveryCache()
})

describe("OAuth credential issuer stamps", () => {
  it("stamps newly persisted tokens and client registrations with the complete issuer", async () => {
    // given
    const provider = new RedirectProvider({ serverUrl: resource })
    // when
    await provider.login()
    // then
    expect(loadToken(resource, resource)).toMatchObject({
      issuer: firstIssuer,
      clientInfo: { issuer: firstIssuer, clientId: "registered-1" },
    })
  })

  it("keeps legacy logins usable and stamps them at the next discovery without registering", async () => {
    // given
    saveToken(resource, resource, {
      accessToken: "legacy-access", refreshToken: "legacy-refresh",
      clientInfo: { clientId: "legacy-client" },
    })
    const provider = new RedirectProvider({ serverUrl: resource })
    expect(provider.tokens()?.accessToken).toBe("legacy-access")
    // when
    await provider.refresh("legacy-refresh")
    // then
    expect(registrations).toBe(0)
    expect(new URLSearchParams(requests[0]?.body).get("client_id")).toBe("legacy-client")
    expect(loadToken(resource, resource)?.issuer).toBe(firstIssuer)
    expect(loadToken(resource, resource)?.clientInfo?.issuer).toBe(firstIssuer)
  })

  it("loads the stamped registration after restart instead of re-registering", async () => {
    // given
    await new RedirectProvider({ serverUrl: resource }).login()
    // when
    await new RedirectProvider({ serverUrl: resource }).login()
    // then
    expect(registrations).toBe(1)
  })

  it("keeps legacy cached access tokens usable without discovery", async () => {
    // given
    saveToken(resource, resource, { accessToken: "legacy-access", clientInfo: { clientId: "legacy-client" } })
    const provider = new RedirectProvider({ serverUrl: resource })
    // when
    const init = await buildHttpRequestInit({ url: resource, oauth: {} }, new Map(), () => provider)
    // then
    expect(init).toEqual({ headers: { Authorization: "Bearer legacy-access" } })
    expect(requests).toEqual([])
    expect(provider.tokens()?.issuer).toBeUndefined()
  })

  it("re-registers through the real post-401 auth handler after an issuer change", async () => {
    // given
    const provider = new RedirectProvider({ serverUrl: resource })
    await provider.login()
    selectedIssuer = "https://new.example.com/issuer"
    requests = []
    // when
    const retried = await handlePostRequestAuthError({
      error: new Error("HTTP 401"), config: { url: resource, oauth: {} },
      authProviders: new Map(), createOAuthProvider: () => provider,
    })
    // then
    expect(retried).toBe(true)
    expect(registrations).toBe(2)
    expect(requests[1]?.body).not.toContain("refresh_token")
    expect(provider.tokens()?.issuer).toBe(selectedIssuer)
  })

  it("does not reuse a separately stamped client registration from another issuer", async () => {
    // given
    saveToken(resource, resource, {
      accessToken: "legacy", clientInfo: { clientId: "foreign-client", issuer: "https://other.example.com" },
    })
    const provider = new RedirectProvider({ serverUrl: resource })
    // when
    await provider.login()
    // then
    expect(registrations).toBe(1)
    expect(provider.clientInformation()?.clientId).toBe("registered-1")
  })

  for (const nextIssuer of ["https://auth.example.com:9443/tenant", "https://auth.example.com:8443/other", "https://other.example.com"]) {
    it(`re-registers on refresh after the issuer changes to ${nextIssuer}`, async () => {
      // given
      const provider = new RedirectProvider({ serverUrl: resource })
      await provider.login()
      selectedIssuer = nextIssuer
      requests = []
      // when
      await provider.refresh("old-refresh-must-not-leak")
      // then
      expect(registrations).toBe(2)
      expect(requests.map((request) => request.url)).toEqual([`${nextIssuer}/register`, `${nextIssuer}/token`])
      const tokenBody = new URLSearchParams(requests[1]?.body)
      expect(tokenBody.get("grant_type")).toBe("authorization_code")
      expect(tokenBody.get("client_id")).toBe("registered-2")
      expect(tokenBody.has("refresh_token")).toBe(false)
      expect(provider.tokens()?.issuer).toBe(nextIssuer)
    })
  }

  it("discards both token and registration when re-login fails, including duplicate legacy storage", async () => {
    // given
    const old = { accessToken: "old", refreshToken: "old-refresh", issuer: firstIssuer, clientInfo: { clientId: "old-client", issuer: firstIssuer } }
    saveToken(resource, resource, old)
    writeFileSync(join(directory, "mcp-oauth.json"), JSON.stringify({ [`resource.example.com/${resource}`]: old }))
    selectedIssuer = "https://new.example.com"
    rejectRegistration = true
    const provider = new RedirectProvider({ serverUrl: resource })
    provider.clientInformation()
    // when
    await expect(provider.refresh("old-refresh")).rejects.toThrow()
    // then
    expect(provider.tokens()).toBeNull()
    expect(provider.clientInformation()).toBeNull()
    expect(requests.every((request) => !request.url.endsWith("/token"))).toBe(true)
  })

  it("uses configured client IDs consistently across two provider instances after issuer changes", async () => {
    // given
    saveToken(resource, resource, {
      accessToken: "old", issuer: firstIssuer,
      clientInfo: { clientId: "old-registration", clientSecret: "old-secret", issuer: firstIssuer },
    })
    selectedIssuer = "https://new.example.com"
    registrationAvailable = false
    const provider = new RedirectProvider({ serverUrl: resource, clientId: "configured" })
    // when
    await provider.login()
    selectedIssuer = "https://third.example.com"
    const restartedProvider = new RedirectProvider({ serverUrl: resource, clientId: "configured" })
    await restartedProvider.login()
    // then
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => request.url)).toEqual([
      "https://new.example.com/token",
      "https://third.example.com/token",
    ])
    for (const request of requests) {
      const body = new URLSearchParams(request.body)
      expect(body.get("client_id")).toBe("configured")
      expect(body.has("client_secret")).toBe(false)
    }
    expect(provider.tokens()?.issuer).toBe(selectedIssuer)
    expect(restartedProvider.tokens()?.issuer).toBe(selectedIssuer)
  })
})
