import { afterEach, describe, expect, it } from "bun:test"
import { discoverOAuthServerMetadata, resetDiscoveryCache } from "./discovery"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  resetDiscoveryCache()
})

function serveMetadata(resource: string, issuer: string, protectedIssuer?: string): string[] {
  const calls: string[] = []
  const origin = new URL(resource).origin
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL) => {
      const url = input.toString()
      calls.push(url)
      if (url === `${origin}/.well-known/oauth-protected-resource` && protectedIssuer) {
        return Response.json({ authorization_servers: [protectedIssuer] })
      }
      if (url === `${origin}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
        })
      }
      return new Response("", { status: 404 })
    },
  })
  return calls
}

describe("OAuth discovery without protected-resource metadata", () => {
  it("discovers a path-served resource using the root metadata issuer", async () => {
    // given
    const resource = "https://mcp.example.com:8443/mcp"
    const issuer = "https://mcp.example.com:8443"
    const calls = serveMetadata(resource, issuer)
    // when
    const metadata = await discoverOAuthServerMetadata(resource)
    // then
    expect(metadata.issuer).toBe(issuer)
    expect(metadata.resource).toBe(resource)
    expect(calls).toEqual([
      `${issuer}/.well-known/oauth-protected-resource`,
      `${issuer}/.well-known/oauth-authorization-server/mcp`,
      `${issuer}/.well-known/oauth-authorization-server`,
    ])
  })

  it("rejects an origin document for a PRM-named path issuer", async () => {
    // given
    const resource = "https://mcp.example.com/mcp"
    serveMetadata(resource, "https://mcp.example.com", "https://mcp.example.com/tenant")
    // when
    const discovery = discoverOAuthServerMetadata(resource)
    // then
    await expect(discovery).rejects.toThrow("issuer mismatch")
  })

  it("accepts a configured root URL with a trailing slash", async () => {
    // given
    const resource = "https://mcp.example.com/"
    serveMetadata(resource, "https://mcp.example.com")
    // when
    const metadata = await discoverOAuthServerMetadata(resource)
    // then
    expect(metadata.issuer).toBe("https://mcp.example.com")
    expect(metadata.resource).toBe(resource)
  })
})
