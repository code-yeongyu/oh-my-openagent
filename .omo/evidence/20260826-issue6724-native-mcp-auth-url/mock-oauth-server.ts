// Isolated QA mock OAuth server for issue #6724 verification.
// Serves HTTPS endpoints required by McpOAuthProvider.login():
//   GET  /.well-known/oauth-protected-resource      -> 404 (forces AS-metadata fallback)
//   GET  /.well-known/oauth-authorization-server/mcp -> AS metadata (https URLs)
//   POST /register                                  -> DCR client_id
//   GET  /authorize                                 -> validates PKCE params, records byte-exact URL, 302 to redirect_uri
//   POST /token                                     -> validates code + PKCE S256 verifier + redirect_uri + client_id
import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"

const CERT_PATH = "/tmp/opencode/issue-6724/certs/cert.pem"
const KEY_PATH = "/tmp/opencode/issue-6724/certs/key.pem"
const STATE_DIR = "/tmp/opencode/issue-6724/mock-state"
mkdirSync(STATE_DIR, { recursive: true })

type IssuedCode = { codeChallenge: string; redirectUri: string; clientId: string; state: string }
const issuedCodes = new Map<string, IssuedCode>()
const registeredClients = new Map<string, string[]>()

function note(name: string, value: unknown): void {
  writeFileSync(`${STATE_DIR}/${name}.json`, JSON.stringify(value, null, 2))
}

const server = Bun.serve({
  port: 0,
  tls: {
    cert: Bun.file(CERT_PATH),
    key: Bun.file(KEY_PATH),
  },
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "GET" && path === "/.well-known/oauth-protected-resource") {
      return new Response("not found", { status: 404 })
    }

    if (
      request.method === "GET" &&
      (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/oauth-authorization-server/mcp")
    ) {
      const base = `https://127.0.0.1:${server.port}`
      return Response.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
      })
    }

    if (request.method === "POST" && path === "/register") {
      const body = (await request.json()) as { redirect_uris?: string[] }
      const clientId = `qa-client-${randomBytes(4).toString("hex")}`
      registeredClients.set(clientId, body.redirect_uris ?? [])
      note("dcr", { clientId, redirect_uris: body.redirect_uris ?? [] })
      return Response.json({ client_id: clientId })
    }

    if (request.method === "GET" && path === "/authorize") {
      const clientId = url.searchParams.get("client_id") ?? ""
      const redirectUri = url.searchParams.get("redirect_uri") ?? ""
      const responseType = url.searchParams.get("response_type") ?? ""
      const codeChallenge = url.searchParams.get("code_challenge") ?? ""
      const state = url.searchParams.get("state") ?? ""

      // Byte-exact record of the authorization URL this server received.
      writeFileSync(`${STATE_DIR}/authorize-url.txt`, request.url, { encoding: "utf8" })
      note("authorize-params", Object.fromEntries(url.searchParams.entries()))

      if (!registeredClients.has(clientId) && clientId !== "qa-static-client") {
        return new Response("unauthorized_client", { status: 400 })
      }
      if (responseType !== "code" || codeChallenge.length === 0 || state.length === 0) {
        return new Response("invalid_request", { status: 400 })
      }
      const registeredUris = registeredClients.get(clientId)
      if (registeredUris && !registeredUris.includes(redirectUri)) {
        return new Response("invalid_redirect_uri", { status: 400 })
      }

      const code = randomBytes(16).toString("hex")
      issuedCodes.set(code, { codeChallenge, redirectUri, clientId, state })
      return new Response(null, {
        status: 302,
        headers: { location: `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}` },
      })
    }

    if (request.method === "POST" && path === "/token") {
      const form = new URLSearchParams(await request.text())
      const grantType = form.get("grant_type") ?? ""
      const code = form.get("code") ?? ""
      const redirectUri = form.get("redirect_uri") ?? ""
      const clientId = form.get("client_id") ?? ""
      const codeVerifier = form.get("code_verifier") ?? ""

      const issued = issuedCodes.get(code)
      if (grantType !== "authorization_code" || !issued) {
        note("token-rejected", { reason: "unknown_code_or_grant", grantType, codePresent: code.length > 0 })
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      }
      const expectedVerifierHash = createHash("sha256").update(codeVerifier).digest("base64url")
      if (expectedVerifierHash !== issued.codeChallenge) {
        note("token-rejected", { reason: "pkce_mismatch" })
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      }
      if (redirectUri !== issued.redirectUri || clientId !== issued.clientId) {
        note("token-rejected", { reason: "redirect_or_client_mismatch" })
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      }

      note("token-accepted", { code, clientId, redirectUri })
      issuedCodes.delete(code)
      return Response.json({
        access_token: `qa-access-${randomBytes(8).toString("hex")}`,
        refresh_token: `qa-refresh-${randomBytes(8).toString("hex")}`,
        expires_in: 3600,
        token_type: "Bearer",
      })
    }

    return new Response("not found", { status: 404 })
  },
})

writeFileSync("/tmp/opencode/issue-6724/mock-port.txt", String(server.port))
console.log(`mock oauth server listening on https://127.0.0.1:${server.port}`)
