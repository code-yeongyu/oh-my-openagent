/**
 * Anthropic OAuth flow for Claude Pro/Max subscriptions.
 *
 * Implements the full PKCE-based OAuth 2.0 authorization code flow
 * against claude.ai, matching the approach used by oh-my-pi.
 *
 * This lets Oh-My-OpenAgent users authenticate with their Claude Max
 * subscription (including 20x usage) instead of burning API credits.
 */

import type { AuthOAuthResult } from "@opencode-ai/plugin"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const TOKEN_URL = "https://api.anthropic.com/v1/oauth/token"
const CALLBACK_PORT = 54545
const CALLBACK_PATH = "/callback"
const SCOPES = "org:create_api_key user:profile user:inference"
const CALLBACK_TIMEOUT_MS = 300_000 // 5 minutes

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(96)
  crypto.getRandomValues(bytes)
  const verifier = Buffer.from(bytes).toString("base64url")
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = Buffer.from(hash).toString("base64url")
  return { verifier, challenge }
}

function generateState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

async function postTokenRequest(
  body: Record<string, string>,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Anthropic token request failed: HTTP ${res.status} — ${text}`)
  }

  try {
    return JSON.parse(text) as { access_token: string; refresh_token: string; expires_in: number }
  } catch {
    throw new Error(`Anthropic token response is not valid JSON: ${text}`)
  }
}

// ---------------------------------------------------------------------------
// Callback server
// ---------------------------------------------------------------------------

const CALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authentication</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
         align-items: center; min-height: 100vh; margin: 0; background: #111; color: #eee; }
  .card { text-align: center; padding: 2rem; }
  .ok { color: #4ade80; }
  .err { color: #f87171; }
</style></head>
<body><div class="card">
  <h2 class="__CLASS__">__TITLE__</h2>
  <p>__MSG__</p>
  <p style="color:#888;font-size:0.85rem;">You can close this tab.</p>
</div></body></html>`

function renderCallbackPage(ok: boolean, detail: string): string {
  return CALLBACK_HTML
    .replace("__CLASS__", ok ? "ok" : "err")
    .replace("__TITLE__", ok ? "✓ Authenticated" : "✗ Authentication Failed")
    .replace("__MSG__", detail)
}

interface CallbackResult {
  code: string
  state: string
}

function startCallbackServer(
  expectedState: string,
  port: number,
): {
  server: ReturnType<typeof Bun.serve>
  promise: Promise<CallbackResult>
  redirectUri: string
} {
  let resolve: ((r: CallbackResult) => void) | undefined
  let reject: ((e: Error) => void) | undefined
  const promise = new Promise<CallbackResult>((res, rej) => {
    resolve = res
    reject = rej
  })

  let server: ReturnType<typeof Bun.serve>

  try {
    server = Bun.serve({
      hostname: "localhost",
      port,
      reusePort: false,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname !== CALLBACK_PATH) {
          return new Response("Not Found", { status: 404 })
        }

        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state") || ""
        const error = url.searchParams.get("error")
        const errorDesc = url.searchParams.get("error_description") || error || "Unknown error"

        if (error) {
          queueMicrotask(() => reject?.(new Error(`Authorization denied: ${errorDesc}`)))
          return new Response(renderCallbackPage(false, errorDesc), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!code) {
          queueMicrotask(() => reject?.(new Error("Missing authorization code in callback")))
          return new Response(renderCallbackPage(false, "Missing authorization code"), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (state !== expectedState) {
          queueMicrotask(() => reject?.(new Error("State mismatch — possible CSRF attack")))
          return new Response(renderCallbackPage(false, "State mismatch"), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        queueMicrotask(() => resolve?.({ code, state }))
        return new Response(
          renderCallbackPage(true, "Claude Max subscription connected to OpenCode."),
          { status: 200, headers: { "Content-Type": "text/html" } },
        )
      },
    })
  } catch {
    // Port busy — try port 0 (OS-assigned)
    server = Bun.serve({
      hostname: "localhost",
      port: 0,
      reusePort: false,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname !== CALLBACK_PATH) {
          return new Response("Not Found", { status: 404 })
        }

        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state") || ""
        const error = url.searchParams.get("error")
        const errorDesc = url.searchParams.get("error_description") || error || "Unknown error"

        if (error) {
          queueMicrotask(() => reject?.(new Error(`Authorization denied: ${errorDesc}`)))
          return new Response(renderCallbackPage(false, errorDesc), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!code) {
          queueMicrotask(() => reject?.(new Error("Missing authorization code in callback")))
          return new Response(renderCallbackPage(false, "Missing authorization code"), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (state !== expectedState) {
          queueMicrotask(() => reject?.(new Error("State mismatch — possible CSRF attack")))
          return new Response(renderCallbackPage(false, "State mismatch"), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        queueMicrotask(() => resolve?.({ code, state }))
        return new Response(
          renderCallbackPage(true, "Claude Max subscription connected to OpenCode."),
          { status: 200, headers: { "Content-Type": "text/html" } },
        )
      },
    })
  }

  const actualPort = server.port
  const redirectUri = `http://localhost:${actualPort}${CALLBACK_PATH}`

  // Timeout guard
  const timer = setTimeout(() => {
    reject?.(new Error("OAuth callback timed out after 5 minutes"))
  }, CALLBACK_TIMEOUT_MS)

  // Attach cleanup to promise settlement
  const cleaned = promise.finally(() => clearTimeout(timer))

  return { server, promise: cleaned, redirectUri }
}

// ---------------------------------------------------------------------------
// Public API: authorize() — returns the AuthOAuthResult expected by OpenCode
// ---------------------------------------------------------------------------

/**
 * Initiates the Anthropic OAuth flow and returns an `AuthOAuthResult`
 * compatible with OpenCode's plugin auth hook system.
 *
 * The flow is "auto" — a local callback server handles the redirect
 * automatically without the user needing to paste a code.
 */
export async function authorizeAnthropic(): Promise<AuthOAuthResult> {
  const state = generateState()
  const pkce = await generatePKCE()

  const { server, promise, redirectUri } = startCallbackServer(state, CALLBACK_PORT)

  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  })

  const authUrl = `${AUTHORIZE_URL}?${params.toString()}`

  return {
    url: authUrl,
    instructions: "Log in with your Anthropic account in the browser. Your Claude Pro/Max subscription will be linked.",
    method: "auto" as const,

    async callback(): Promise<
      | { type: "success"; refresh: string; access: string; expires: number; provider?: string }
      | { type: "failed" }
    > {
      try {
        const { code } = await promise

        const tokenData = await postTokenRequest({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code,
          state,
          redirect_uri: redirectUri,
          code_verifier: pkce.verifier,
        })

        return {
          type: "success",
          refresh: tokenData.refresh_token,
          access: tokenData.access_token,
          // Expire 5 minutes early to avoid edge-case failures
          expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
        }
      } catch {
        return { type: "failed" }
      } finally {
        server.stop()
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export interface AnthropicOAuthCredentials {
  refresh: string
  access: string
  expires: number
}

/**
 * Refresh an expired Anthropic OAuth access token.
 */
export async function refreshAnthropicToken(
  refreshToken: string,
): Promise<AnthropicOAuthCredentials> {
  const data = await postTokenRequest({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  })

  return {
    refresh: data.refresh_token || refreshToken,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  }
}
