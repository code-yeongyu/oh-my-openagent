/**
 * Antigravity OAuth 2.0 flow implementation with PKCE.
 * Handles Google OAuth for Antigravity authentication.
 */
import { generatePKCE } from "@openauthjs/openauth/pkce"

import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_CALLBACK_PORT,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from "./constants"
import type {
  AntigravityTokenExchangeResult,
  AntigravityUserInfo,
} from "./types"

/**
 * PKCE pair containing verifier and challenge.
 */
export interface PKCEPair {
  /** PKCE verifier - used during token exchange */
  verifier: string
  /** PKCE challenge - sent in auth URL */
  challenge: string
  /** Challenge method - always "S256" */
  method: string
}

/**
 * OAuth state encoded in the auth URL.
 * Contains the PKCE verifier for later retrieval.
 */
export interface OAuthState {
  /** PKCE verifier */
  verifier: string
  /** Optional project ID */
  projectId?: string
}

/**
 * Result from building an OAuth authorization URL.
 */
export interface AuthorizationResult {
  /** Full OAuth URL to open in browser */
  url: string
  /** PKCE verifier to use during code exchange */
  verifier: string
}

/**
 * Result from the OAuth callback server.
 */
export interface CallbackResult {
  /** Authorization code from Google */
  code: string
  /** State parameter from callback */
  state: string
  /** Error message if any */
  error?: string
}

/**
 * Generate PKCE verifier and challenge pair.
 * Uses @openauthjs/openauth for cryptographically secure generation.
 *
 * @returns PKCE pair with verifier, challenge, and method
 */
export async function generatePKCEPair(): Promise<PKCEPair> {
  const pkce = await generatePKCE()
  return {
    verifier: pkce.verifier,
    challenge: pkce.challenge,
    method: pkce.method,
  }
}

/**
 * Encode OAuth state into a URL-safe base64 string.
 *
 * @param state - OAuth state object
 * @returns Base64URL encoded state
 */
function encodeState(state: OAuthState): string {
  const json = JSON.stringify(state)
  return Buffer.from(json, "utf8").toString("base64url")
}

/**
 * Decode OAuth state from a base64 string.
 *
 * @param encoded - Base64URL or Base64 encoded state
 * @returns Decoded OAuth state
 */
export function decodeState(encoded: string): OAuthState {
  // Handle both base64url and standard base64
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )
  const json = Buffer.from(padded, "base64").toString("utf8")
  const parsed = JSON.parse(json)

  if (typeof parsed.verifier !== "string") {
    throw new Error("Missing PKCE verifier in state")
  }

  return {
    verifier: parsed.verifier,
    projectId:
      typeof parsed.projectId === "string" ? parsed.projectId : undefined,
  }
}

/**
 * Build the OAuth authorization URL with PKCE.
 *
 * @param projectId - Optional GCP project ID to include in state
 * @param clientId - Optional custom client ID (defaults to ANTIGRAVITY_CLIENT_ID)
 * @returns Authorization result with URL and verifier
 */
export async function buildAuthURL(
  projectId?: string,
  clientId: string = ANTIGRAVITY_CLIENT_ID
): Promise<AuthorizationResult> {
  const pkce = await generatePKCEPair()

  const state: OAuthState = {
    verifier: pkce.verifier,
    projectId,
  }

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "))
  url.searchParams.set("state", encodeState(state))
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")

  return {
    url: url.toString(),
    verifier: pkce.verifier,
  }
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @param verifier - PKCE verifier from initial auth request
 * @param clientId - Optional custom client ID (defaults to ANTIGRAVITY_CLIENT_ID)
 * @param clientSecret - Optional custom client secret (defaults to ANTIGRAVITY_CLIENT_SECRET)
 * @returns Token exchange result with access and refresh tokens
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  clientId: string = ANTIGRAVITY_CLIENT_ID,
  clientSecret: string = ANTIGRAVITY_CLIENT_SECRET
): Promise<AntigravityTokenExchangeResult> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: ANTIGRAVITY_REDIRECT_URI,
    code_verifier: verifier,
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
  }
}

/**
 * Fetch user info from Google's userinfo API.
 *
 * @param accessToken - Valid access token
 * @returns User info containing email
 */
export async function fetchUserInfo(
  accessToken: string
): Promise<AntigravityUserInfo> {
  const response = await fetch(`${GOOGLE_USERINFO_URL}?alt=json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.status}`)
  }

  const data = (await response.json()) as {
    email?: string
    name?: string
    picture?: string
  }

  return {
    email: data.email || "",
    name: data.name,
    picture: data.picture,
  }
}

/**
 * Start a local HTTP server to receive OAuth callback.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
 * @returns Promise that resolves with callback result
 */
export function startCallbackServer(
  timeoutMs: number = 5 * 60 * 1000
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let server: ReturnType<typeof Bun.serve> | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (server) {
        server.stop()
        server = null
      }
    }

    // Set timeout
    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error("OAuth callback timeout"))
    }, timeoutMs)

    try {
      server = Bun.serve({
        port: ANTIGRAVITY_CALLBACK_PORT,
        fetch(request: Request): Response {
          const url = new URL(request.url)

          if (url.pathname === "/oauth-callback") {
            const code = url.searchParams.get("code") || ""
            const state = url.searchParams.get("state") || ""
            const error = url.searchParams.get("error") || undefined

            // Respond to browser
            let responseBody: string
            if (code && !error) {
              responseBody =
                "<html><body><h1>Login successful</h1><p>You can close this window.</p></body></html>"
            } else {
              responseBody =
                "<html><body><h1>Login failed</h1><p>Please check the CLI output.</p></body></html>"
            }

            // Schedule cleanup and resolve
            setTimeout(() => {
              cleanup()
              resolve({ code, state, error })
            }, 100)

            return new Response(responseBody, {
              status: 200,
              headers: { "Content-Type": "text/html" },
            })
          }

          return new Response("Not Found", { status: 404 })
        },
      })
    } catch (err) {
      cleanup()
      reject(
        new Error(
          `Failed to start callback server: ${err instanceof Error ? err.message : String(err)}`
        )
      )
    }
  })
}

/**
 * Perform complete OAuth flow:
 * 1. Start callback server
 * 2. Build auth URL
 * 3. Wait for callback
 * 4. Exchange code for tokens
 * 5. Fetch user info
 *
 * @param projectId - Optional GCP project ID
 * @param openBrowser - Function to open URL in browser
 * @param clientId - Optional custom client ID (defaults to ANTIGRAVITY_CLIENT_ID)
 * @param clientSecret - Optional custom client secret (defaults to ANTIGRAVITY_CLIENT_SECRET)
 * @returns Object with tokens and user info
 */
export async function performOAuthFlow(
  projectId?: string,
  openBrowser?: (url: string) => Promise<void>,
  clientId: string = ANTIGRAVITY_CLIENT_ID,
  clientSecret: string = ANTIGRAVITY_CLIENT_SECRET
): Promise<{
  tokens: AntigravityTokenExchangeResult
  userInfo: AntigravityUserInfo
  verifier: string
}> {
  // Build auth URL first to get the verifier
  const auth = await buildAuthURL(projectId, clientId)

  // Start callback server
  const callbackPromise = startCallbackServer()

  // Open browser (caller provides implementation)
  if (openBrowser) {
    await openBrowser(auth.url)
  }

  // Wait for callback
  const callback = await callbackPromise

  if (callback.error) {
    throw new Error(`OAuth error: ${callback.error}`)
  }

  if (!callback.code) {
    throw new Error("No authorization code received")
  }

  // Verify state and extract verifier
  const state = decodeState(callback.state)
  if (state.verifier !== auth.verifier) {
    throw new Error("PKCE verifier mismatch - possible CSRF attack")
  }

  // Exchange code for tokens
  const tokens = await exchangeCode(callback.code, auth.verifier, clientId, clientSecret)

  // Fetch user info
  const userInfo = await fetchUserInfo(tokens.access_token)

  return {
    tokens,
    userInfo,
    verifier: auth.verifier,
  }
}
