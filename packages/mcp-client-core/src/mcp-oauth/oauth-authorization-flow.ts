import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

export type OAuthCallbackResult = {
  code: string
  state: string
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  options: {
    clientId: string
    redirectUri: string
    codeChallenge: string
    state: string
    scopes?: string[]
    resource?: string
  }
): string {
  const url = new URL(authorizationEndpoint)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", options.clientId)
  url.searchParams.set("redirect_uri", options.redirectUri)
  url.searchParams.set("code_challenge", options.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", options.state)
  if (options.scopes && options.scopes.length > 0) {
    url.searchParams.set("scope", options.scopes.join(" "))
  }
  if (options.resource) {
    url.searchParams.set("resource", options.resource)
  }
  return url.toString()
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_CALLBACK_PATH = "/callback"

export type CallbackServerOptions = {
  /** The only path a callback is accepted on. Defaults to `/callback`. */
  readonly expectedPath?: string
  /**
   * When set, a callback whose `state` does not match is refused and the server keeps waiting.
   * The caller also compares the state, so this is the in-server layer of the same check.
   */
  readonly expectedState?: string
}

function callbackPathOf(redirectUri: string | undefined): string {
  if (redirectUri === undefined) return DEFAULT_CALLBACK_PATH
  try {
    const path = new URL(redirectUri).pathname
    return path === "" ? DEFAULT_CALLBACK_PATH : path
  } catch (error) {
    if (error instanceof TypeError) return DEFAULT_CALLBACK_PATH
    throw error
  }
}

export function startCallbackServer(port: number, options: CallbackServerOptions = {}): Promise<OAuthCallbackResult> {
  const expectedPath = options.expectedPath ?? DEFAULT_CALLBACK_PATH
  const expectedState = options.expectedState

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout>
    let settled = false

    // Every terminal outcome goes through here exactly once, so the timeout is cleared on a real
    // result and stays armed for every request that is not one.
    const finish = (outcome: { readonly resolve: OAuthCallbackResult } | { readonly reject: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      server.close()
      if ("resolve" in outcome) resolve(outcome.resolve)
      else reject(outcome.reject)
    }

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://localhost:${port}`)

      // A request that is not the callback is not a result: answer it and keep waiting. Browsers
      // send speculative requests (favicon, prefetch, and any page that can reach loopback) and a
      // single one of them must not end a login in progress.
      if (requestUrl.pathname !== expectedPath) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        response.end("Not Found")
        return
      }

      const error = requestUrl.searchParams.get("error")
      if (error) {
        const errorDescription = requestUrl.searchParams.get("error_description") ?? error
        response.writeHead(400, { "content-type": "text/html" })
        response.end("<html><body><h1>Authorization failed</h1></body></html>")
        finish({ reject: new Error(`OAuth authorization error: ${errorDescription}`) })
        return
      }

      const code = requestUrl.searchParams.get("code")
      const state = requestUrl.searchParams.get("state")

      // A callback without a code, without a state, or with the wrong state is not this flow's
      // result. Answer it and keep waiting for the real one; the timeout still bounds the wait.
      if (!code || !state || (expectedState !== undefined && state !== expectedState)) {
        response.writeHead(400, { "content-type": "text/html" })
        response.end("<html><body><h1>Missing or invalid code or state</h1></body></html>")
        return
      }

      response.writeHead(200, { "content-type": "text/html" })
      response.end("<html><body><h1>Authorization successful. You can close this tab.</h1></body></html>")
      finish({ resolve: { code, state } })
    })

    timeoutId = setTimeout(() => {
      finish({ reject: new Error("OAuth callback timed out after 5 minutes") })
    }, CALLBACK_TIMEOUT_MS)

    server.listen(port, "127.0.0.1")
    server.on("error", (err) => {
      clearTimeout(timeoutId)
      reject(err)
    })
  })
}

function openBrowser(url: string): void {
  const platform = process.platform
  let command: string
  let args: string[]

  if (platform === "darwin") {
    command = "open"
    args = [url]
  } else if (platform === "win32") {
    command = "explorer"
    args = [url]
  } else {
    command = "xdg-open"
    args = [url]
  }

  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true })
    child.on("error", () => {})
    child.unref()
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
}

export async function runAuthorizationCodeRedirect(options: {
  authorizationEndpoint: string
  callbackPort: number
  clientId: string
  redirectUri: string
  scopes?: string[]
  resource?: string
}): Promise<{ code: string; verifier: string }> {
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = randomBytes(16).toString("hex")

  const authorizationUrl = buildAuthorizationUrl(options.authorizationEndpoint, {
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    codeChallenge: challenge,
    state,
    scopes: options.scopes,
    resource: options.resource,
  })

  // The server accepts the callback only on the redirect URI's own path and only with this
  // state, so a stray or spoofed request cannot end the flow.
  const callbackPromise = startCallbackServer(options.callbackPort, {
    expectedPath: callbackPathOf(options.redirectUri),
    expectedState: state,
  })
  openBrowser(authorizationUrl)

  const result = await callbackPromise
  if (result.state !== state) {
    throw new Error("OAuth state mismatch")
  }

  return { code: result.code, verifier }
}
