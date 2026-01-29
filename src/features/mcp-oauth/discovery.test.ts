import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { discoverOAuthServerMetadata, resetDiscoveryCache } from "./discovery"

describe("discoverOAuthServerMetadata", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    resetDiscoveryCache()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true })
  })

  test("returns endpoints from PRM + AS discovery", () => {
    // #given
    const resource = "https://mcp.example.com"
    const prmUrl = new URL("/.well-known/oauth-protected-resource", resource).toString()
    const authServer = "https://auth.example.com"
    const asUrl = new URL("/.well-known/oauth-authorization-server", authServer).toString()
    const calls: string[] = []
    const fetchMock = async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      calls.push(url)
      if (url === prmUrl) {
        return new Response(JSON.stringify({ authorization_servers: [authServer] }), { status: 200 })
      }
      if (url === asUrl) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth.example.com/authorize",
            token_endpoint: "https://auth.example.com/token",
            registration_endpoint: "https://auth.example.com/register",
          }),
          { status: 200 }
        )
      }
      return new Response("not found", { status: 404 })
    }
    Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })

    // #when
    return discoverOAuthServerMetadata(resource).then((result) => {
      // #then
      expect(result).toEqual({
        authorizationEndpoint: "https://auth.example.com/authorize",
        tokenEndpoint: "https://auth.example.com/token",
        registrationEndpoint: "https://auth.example.com/register",
        resource,
      })
      expect(calls).toEqual([prmUrl, asUrl])
    })
  })

  test("falls back to RFC 8414 when PRM returns 404", () => {
    // #given
    const resource = "https://mcp.example.com"
    const prmUrl = new URL("/.well-known/oauth-protected-resource", resource).toString()
    const asUrl = new URL("/.well-known/oauth-authorization-server", resource).toString()
    const calls: string[] = []
    const fetchMock = async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      calls.push(url)
      if (url === prmUrl) {
        return new Response("not found", { status: 404 })
      }
      if (url === asUrl) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: "https://mcp.example.com/authorize",
            token_endpoint: "https://mcp.example.com/token",
          }),
          { status: 200 }
        )
      }
      return new Response("not found", { status: 404 })
    }
    Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })

    // #when
    return discoverOAuthServerMetadata(resource).then((result) => {
      // #then
      expect(result).toEqual({
        authorizationEndpoint: "https://mcp.example.com/authorize",
        tokenEndpoint: "https://mcp.example.com/token",
        registrationEndpoint: undefined,
        resource,
      })
      expect(calls).toEqual([prmUrl, asUrl])
    })
  })

  test("throws when both PRM and AS discovery return 404", () => {
    // #given
    const resource = "https://mcp.example.com"
    const prmUrl = new URL("/.well-known/oauth-protected-resource", resource).toString()
    const asUrl = new URL("/.well-known/oauth-authorization-server", resource).toString()
    const fetchMock = async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === prmUrl || url === asUrl) {
        return new Response("not found", { status: 404 })
      }
      return new Response("not found", { status: 404 })
    }
    Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })

    // #when
    const result = discoverOAuthServerMetadata(resource)

    // #then
    return expect(result).rejects.toThrow("OAuth authorization server metadata not found")
  })

  test("throws when AS metadata is malformed", () => {
    // #given
    const resource = "https://mcp.example.com"
    const prmUrl = new URL("/.well-known/oauth-protected-resource", resource).toString()
    const authServer = "https://auth.example.com"
    const asUrl = new URL("/.well-known/oauth-authorization-server", authServer).toString()
    const fetchMock = async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url === prmUrl) {
        return new Response(JSON.stringify({ authorization_servers: [authServer] }), { status: 200 })
      }
      if (url === asUrl) {
        return new Response(JSON.stringify({ authorization_endpoint: "https://auth.example.com/authorize" }), {
          status: 200,
        })
      }
      return new Response("not found", { status: 404 })
    }
    Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })

    // #when
    const result = discoverOAuthServerMetadata(resource)

    // #then
    return expect(result).rejects.toThrow("token_endpoint")
  })

  test("caches discovery results per resource URL", () => {
    // #given
    const resource = "https://mcp.example.com"
    const prmUrl = new URL("/.well-known/oauth-protected-resource", resource).toString()
    const authServer = "https://auth.example.com"
    const asUrl = new URL("/.well-known/oauth-authorization-server", authServer).toString()
    const calls: string[] = []
    const fetchMock = async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      calls.push(url)
      if (url === prmUrl) {
        return new Response(JSON.stringify({ authorization_servers: [authServer] }), { status: 200 })
      }
      if (url === asUrl) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth.example.com/authorize",
            token_endpoint: "https://auth.example.com/token",
          }),
          { status: 200 }
        )
      }
      return new Response("not found", { status: 404 })
    }
    Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true })

    // #when
    return discoverOAuthServerMetadata(resource)
      .then(() => discoverOAuthServerMetadata(resource))
      .then(() => {
        // #then
        expect(calls).toEqual([prmUrl, asUrl])
      })
  })
})
