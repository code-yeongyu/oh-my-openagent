import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { findAvailablePort as findAvailablePortShared } from "../../shared/port-utils"

const DEFAULT_PORT = 19877
const TIMEOUT_MS = 5 * 60 * 1000

export type OAuthCallbackResult = {
  code: string
  state: string
}

export type CallbackServer = {
  port: number
  waitForCallback: () => Promise<OAuthCallbackResult>
  close: () => void
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OAuth Authorized</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    .container { text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization successful</h1>
    <p>You can close this window and return to your terminal.</p>
  </div>
</body>
</html>`

export async function findAvailablePort(startPort: number = DEFAULT_PORT): Promise<number> {
  return findAvailablePortShared(startPort)
}

export async function startCallbackServer(startPort: number = DEFAULT_PORT): Promise<CallbackServer> {
  const requestedPort = await findAvailablePort(startPort).catch(() => 0)

  let resolveCallback: ((result: OAuthCallbackResult) => void) | null = null
  let rejectCallback: ((error: Error) => void) | null = null

  const callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  const timeoutId = setTimeout(() => {
    rejectCallback?.(new Error("OAuth callback timed out after 5 minutes"))
    server.close()
  }, TIMEOUT_MS)

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const host = request.headers.host ?? "127.0.0.1"
    const url = new URL(request.url ?? "/", `http://${host}`)

    if (url.pathname !== "/oauth/callback") {
      response.statusCode = 404
      response.end("Not Found")
      return
    }

    const oauthError = url.searchParams.get("error")
    if (oauthError) {
      const description = url.searchParams.get("error_description") ?? oauthError
      clearTimeout(timeoutId)
      rejectCallback?.(new Error(`OAuth authorization failed: ${description}`))
      response.statusCode = 400
      response.end(`Authorization failed: ${description}`)
      setTimeout(() => server.close(), 100)
      return
    }

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")

    if (!code || !state) {
      clearTimeout(timeoutId)
      rejectCallback?.(new Error("OAuth callback missing code or state parameter"))
      response.statusCode = 400
      response.end("Missing code or state parameter")
      setTimeout(() => server.close(), 100)
      return
    }

    resolveCallback?.({ code, state })
    clearTimeout(timeoutId)

    response.statusCode = 200
    response.setHeader("content-type", "text/html; charset=utf-8")
    response.end(SUCCESS_HTML)
    setTimeout(() => server.close(), 100)
  })

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => {
      clearTimeout(timeoutId)
      reject(error)
    }

    server.once("error", handleError)
    server.once("listening", () => {
      server.off("error", handleError)
      resolve()
    })
    server.listen(requestedPort, "127.0.0.1")
  })

  const address = server.address()
  const activePort = typeof address === "object" && address !== null ? address.port : requestedPort

  return {
    port: activePort,
    waitForCallback: () => callbackPromise,
    close: () => {
      clearTimeout(timeoutId)
      server.close()
    },
  }
}
