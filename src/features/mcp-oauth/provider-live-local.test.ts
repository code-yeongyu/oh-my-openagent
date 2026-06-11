import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetDiscoveryCache } from "./discovery"
import { McpOAuthProvider } from "./provider"
import { setOAuthBrowserOpenerForTesting } from "./oauth-authorization-flow"

const nativeFetch = globalThis.fetch.bind(globalThis)

type LocalOAuthServer = {
  origin: string
  close(): Promise<void>
  requests: {
    registeredRedirectUris: string[]
    tokenBodies: URLSearchParams[]
    authorizeQueries: URLSearchParams[]
  }
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.statusCode = 200
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ""
  for await (const chunk of request) {
    body += chunk.toString()
  }
  return body
}

async function startLocalOAuthServer(): Promise<LocalOAuthServer> {
  const requests: LocalOAuthServer["requests"] = {
    registeredRedirectUris: [],
    tokenBodies: [],
    authorizeQueries: [],
  }

  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const url = new URL(request.url ?? "/", origin)

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      sendJson(response, { authorization_servers: [origin] })
      return
    }

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      sendJson(response, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
      })
      return
    }

    if (url.pathname === "/register") {
      const body = JSON.parse(await readBody(request)) as { redirect_uris?: string[] }
      requests.registeredRedirectUris.push(...(body.redirect_uris ?? []))
      sendJson(response, { client_id: "local-client" })
      return
    }

    if (url.pathname === "/authorize") {
      requests.authorizeQueries.push(url.searchParams)
      const redirectUri = url.searchParams.get("redirect_uri")
      const state = url.searchParams.get("state")
      if (!redirectUri || !state) {
        response.statusCode = 400
        response.end("missing redirect_uri or state")
        return
      }
      const callbackUrl = new URL(redirectUri)
      callbackUrl.searchParams.set("code", "local-code")
      callbackUrl.searchParams.set("state", state)
      response.statusCode = 302
      response.setHeader("location", callbackUrl.toString())
      response.end()
      return
    }

    if (url.pathname === "/token") {
      const body = new URLSearchParams(await readBody(request))
      requests.tokenBodies.push(body)
      sendJson(response, {
        access_token: "local-access-token",
        refresh_token: "local-refresh-token",
        expires_in: 3600,
      })
      return
    }

    response.statusCode = 404
    response.end("not found")
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })

  const address = server.address()
  if (typeof address === "string" || address === null) {
    throw new Error("local OAuth server did not bind to a TCP port")
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

describe("McpOAuthProvider local live OAuth flow", () => {
  let originalConfigDir: string | undefined
  let configDir = ""

  beforeEach(() => {
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    configDir = mkdtempSync(join(tmpdir(), "mcp-oauth-live-local-"))
    process.env.OPENCODE_CONFIG_DIR = configDir
    resetDiscoveryCache()
  })

  afterEach(() => {
    setOAuthBrowserOpenerForTesting()
    resetDiscoveryCache()
    if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    if (configDir) rmSync(configDir, { recursive: true, force: true })
    configDir = ""
  })

  test("#given a local OAuth server #when provider login runs #then it completes DCR callback and token exchange", async () => {
    const server = await startLocalOAuthServer()
    try {
      setOAuthBrowserOpenerForTesting((url) => {
        void nativeFetch(url).catch(() => undefined)
      })
      const provider = new McpOAuthProvider({ serverUrl: server.origin, scopes: ["read", "write"], fetch: nativeFetch })

      const token = await provider.login()

      expect(token.accessToken).toBe("local-access-token")
      expect(token.refreshToken).toBe("local-refresh-token")
      expect(token.clientInfo?.clientId).toBe("local-client")
      expect(provider.tokens()?.accessToken).toBe("local-access-token")
      const registeredRedirectUri = server.requests.registeredRedirectUris[0]
      expect(registeredRedirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback/)
      expect(server.requests.authorizeQueries[0]?.get("redirect_uri")).toBe(registeredRedirectUri)
      expect(server.requests.authorizeQueries[0]?.get("scope")).toBe("read write")
      expect(server.requests.authorizeQueries[0]?.get("code_challenge_method")).toBe("S256")
      expect(server.requests.tokenBodies[0]?.get("grant_type")).toBe("authorization_code")
      expect(server.requests.tokenBodies[0]?.get("code")).toBe("local-code")
      expect(server.requests.tokenBodies[0]?.get("client_id")).toBe("local-client")
      expect(server.requests.tokenBodies[0]?.get("redirect_uri")).toBe(registeredRedirectUri)
      expect(server.requests.tokenBodies[0]?.get("code_verifier")).toBeTruthy()
    } finally {
      await server.close()
    }
  })
})
