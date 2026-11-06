import { afterEach, describe, expect, it } from "bun:test"
import { findAvailablePort } from "./callback-server"
import { discoverOAuthServerMetadata, resetDiscoveryCache } from "./discovery"
import { startCallbackServer } from "./oauth-authorization-flow"

const originalFetch = globalThis.fetch
const issuer = "https://auth.example.com:8443/tenant"

afterEach(() => {
  globalThis.fetch = originalFetch
  resetDiscoveryCache()
})

describe("OAuth metadata issuer validation", () => {
  for (const metadataIssuer of [undefined, "https://other.example.com", `${issuer}/`]) {
    it(`rejects metadata issuer ${metadataIssuer}`, async () => {
      // given
      Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (input: RequestInfo | URL) => new Response(JSON.stringify(
        input.toString().includes("oauth-protected-resource")
          ? { authorization_servers: [issuer] }
          : {
              issuer: metadataIssuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
            },
      )) })

      // when
      const discovery = discoverOAuthServerMetadata("https://resource.example.com/mcp")

      // then
      await expect(discovery).rejects.toThrow("issuer")
    })
  }

  it("retains the exact validated issuer and response advertisement", async () => {
    // given
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (input: RequestInfo | URL) => new Response(JSON.stringify(
      input.toString().includes("oauth-protected-resource")
        ? { authorization_servers: [issuer] }
        : {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            authorization_response_iss_parameter_supported: true,
          },
    )) })

    // when
    const metadata = await discoverOAuthServerMetadata("https://resource.example.com/mcp")

    // then
    expect(metadata.issuer).toBe(issuer)
    expect(metadata.authorizationResponseIssParameterSupported).toBe(true)
  })
})

describe("OAuth callback issuer validation before redemption", () => {
  for (const receivedIssuer of ["https://attacker.example.com", `${issuer}/`, "", "https://AUTH.example.com:8443/tenant"]) {
    it(`rejects a present issuer ${receivedIssuer} before returning the code`, async () => {
      // given
      const port = await findAvailablePort()
      const callback = startCallbackServer(port, { issuer })
      const outcome = callback.catch((error: unknown) => error)
      const params = new URLSearchParams({ code: "do-not-redeem", state: "state", iss: receivedIssuer })

      // when
      const response = await fetch(`http://127.0.0.1:${port}/callback?${params}`)

      // then
      expect(await outcome).toBeInstanceOf(Error)
      expect(response.status).toBe(400)
    })
  }

  it("rejects an absent issuer when metadata advertises it", async () => {
    // given
    const port = await findAvailablePort()
    const callback = startCallbackServer(port, { issuer, authorizationResponseIssParameterSupported: true })
    const outcome = callback.catch((error: unknown) => error)

    // when
    await fetch(`http://127.0.0.1:${port}/callback?code=code&state=state`)

    // then
    expect(await outcome).toBeInstanceOf(Error)
  })

  for (const returnedIssuer of [undefined, issuer]) {
    it(`accepts a compatible callback with issuer ${returnedIssuer}`, async () => {
      // given
      const port = await findAvailablePort()
      const callback = startCallbackServer(port, { issuer })
      const params = new URLSearchParams({ code: "code", state: "state" })
      if (returnedIssuer !== undefined) params.set("iss", returnedIssuer)

      // when
      await fetch(`http://127.0.0.1:${port}/callback?${params}`)

      // then
      await expect(callback).resolves.toEqual({ code: "code", state: "state" })
    })
  }

  it("does not expose error details from a mismatched issuer", async () => {
    // given
    const port = await findAvailablePort()
    const callback = startCallbackServer(port, { issuer })
    const outcome = callback.catch((error: unknown) => error)
    const params = new URLSearchParams({ error: "access_denied", error_description: "untrusted detail", iss: "https://attacker.example.com" })

    // when
    const response = await fetch(`http://127.0.0.1:${port}/callback?${params}`)

    // then
    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error("Expected rejected callback")
    expect(error.message).not.toContain("untrusted detail")
    expect(await response.text()).not.toContain("untrusted detail")
  })
})
