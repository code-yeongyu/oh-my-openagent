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

export function startCallbackServer(port: number): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout>

    const server = createServer((request, response) => {
      clearTimeout(timeoutId)

      const requestUrl = new URL(request.url ?? "/", `http://localhost:${port}`)
      const code = requestUrl.searchParams.get("code")
      const state = requestUrl.searchParams.get("state")
      const error = requestUrl.searchParams.get("error")

      if (error) {
        const errorDescription = requestUrl.searchParams.get("error_description") ?? error
        response.writeHead(400, { "content-type": "text/html" })
        response.end("<html><body><h1>Authorization failed</h1></body></html>")
        server.close()
        reject(new Error(`OAuth authorization error: ${errorDescription}`))
        return
      }

      if (!code || !state) {
        response.writeHead(400, { "content-type": "text/html" })
        response.end("<html><body><h1>Missing code or state</h1></body></html>")
        server.close()
        reject(new Error("OAuth callback missing code or state parameter"))
        return
      }

      response.writeHead(200, { "content-type": "text/html" })
      response.end("<html><body><h1>Authorization successful. You can close this tab.</h1></body></html>")
      server.close()
      resolve({ code, state })
    })

    timeoutId = setTimeout(() => {
      server.close()
      reject(new Error("OAuth callback timed out after 5 minutes"))
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
    const child = spawn(command, args, { stdio: "ignore", detached: true })
    child.on("error", () => {})
    child.unref()
  } catch {
    // Browser open failed — user must navigate manually
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

  const callbackPromise = startCallbackServer(options.callbackPort)
  openBrowser(authorizationUrl)

  const result = await callbackPromise
  if (result.state !== state) {
    throw new Error("OAuth state mismatch")
  }

  return { code: result.code, verifier }
}
