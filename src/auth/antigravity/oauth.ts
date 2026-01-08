/**
 * Antigravity OAuth 2.0 flow implementation.
 * Handles Google OAuth for Antigravity authentication.
 */
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
 * Result from building an OAuth authorization URL.
 */
export interface AuthorizationResult {
  /** Full OAuth URL to open in browser */
  url: string
  /** State for CSRF protection */
  state: string
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

export async function buildAuthURL(
  projectId?: string,
  clientId: string = ANTIGRAVITY_CLIENT_ID,
  port: number = ANTIGRAVITY_CALLBACK_PORT
): Promise<AuthorizationResult> {
  const state = crypto.randomUUID().replace(/-/g, "")

  const redirectUri = `http://localhost:${port}/oauth-callback`

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")

  return {
    url: url.toString(),
    state,
  }
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @param redirectUri - OAuth redirect URI
 * @param clientId - Optional custom client ID (defaults to ANTIGRAVITY_CLIENT_ID)
 * @param clientSecret - Optional custom client secret (defaults to ANTIGRAVITY_CLIENT_SECRET)
 * @returns Token exchange result with access and refresh tokens
 */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  clientId: string = ANTIGRAVITY_CLIENT_ID,
  clientSecret: string = ANTIGRAVITY_CLIENT_SECRET
): Promise<AntigravityTokenExchangeResult> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
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

export interface CallbackServerHandle {
  port: number
  redirectUri: string
  waitForCallback: () => Promise<CallbackResult>
  close: () => void
}

export function startCallbackServer(
  timeoutMs: number = 5 * 60 * 1000
): CallbackServerHandle {
  let server: ReturnType<typeof Bun.serve> | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let resolveCallback: ((result: CallbackResult) => void) | null = null
  let rejectCallback: ((error: Error) => void) | null = null

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

  const fetchHandler = (request: Request): Response => {
    const url = new URL(request.url)

    if (url.pathname === "/oauth-callback") {
      const code = url.searchParams.get("code") || ""
      const state = url.searchParams.get("state") || ""
      const error = url.searchParams.get("error") || undefined

      let responseBody: string
      if (code && !error) {
        responseBody =
          "<html><body><h1>Login successful</h1><p>You can close this window.</p></body></html>"
      } else {
        responseBody =
          "<html><body><h1>Login failed</h1><p>Please check the CLI output.</p></body></html>"
      }

      setTimeout(() => {
        cleanup()
        if (resolveCallback) {
          resolveCallback({ code, state, error })
        }
      }, 100)

      return new Response(responseBody, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    }

    return new Response("Not Found", { status: 404 })
  }

  try {
    server = Bun.serve({
      port: ANTIGRAVITY_CALLBACK_PORT,
      fetch: fetchHandler,
    })
  } catch (error) {
    server = Bun.serve({
      port: 0,
      fetch: fetchHandler,
    })
  }

  const actualPort = server.port as number
  const redirectUri = `http://localhost:${actualPort}/oauth-callback`

  const waitForCallback = (): Promise<CallbackResult> => {
    return new Promise((resolve, reject) => {
      resolveCallback = resolve
      rejectCallback = reject

      timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error("OAuth callback timeout"))
      }, timeoutMs)
    })
  }

  return {
    port: actualPort,
    redirectUri,
    waitForCallback,
    close: cleanup,
  }
}

export async function performOAuthFlow(
  projectId?: string,
  openBrowser?: (url: string) => Promise<void>,
  clientId: string = ANTIGRAVITY_CLIENT_ID,
  clientSecret: string = ANTIGRAVITY_CLIENT_SECRET
): Promise<{
  tokens: AntigravityTokenExchangeResult
  userInfo: AntigravityUserInfo
  state: string
}> {
  const serverHandle = startCallbackServer()

  try {
    const auth = await buildAuthURL(projectId, clientId, serverHandle.port)

    if (openBrowser) {
      await openBrowser(auth.url)
    }

    const callback = await serverHandle.waitForCallback()

    if (callback.error) {
      throw new Error(`OAuth error: ${callback.error}`)
    }

    if (!callback.code) {
      throw new Error("No authorization code received")
    }

    if (callback.state !== auth.state) {
      throw new Error("State mismatch - possible CSRF attack")
    }

    const redirectUri = `http://localhost:${serverHandle.port}/oauth-callback`
    const tokens = await exchangeCode(callback.code, redirectUri, clientId, clientSecret)
    const userInfo = await fetchUserInfo(tokens.access_token)

    return { tokens, userInfo, state: auth.state }
  } catch (err) {
    serverHandle.close()
    throw err
  }
}
