import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createConnection } from "node:net"

import { findAvailablePort as findAvailablePortShared } from "../../shared/port-utils"

const DEFAULT_PORT = 19877
const TIMEOUT_MS = 5 * 60 * 1000
const STARTUP_TIMEOUT_MS = 2_000

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

function waitForServerReady(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      if (error) {
        reject(error)
        return
      }
      resolve()
    }

    socket.setTimeout(STARTUP_TIMEOUT_MS, () => {
      finish(new Error(`OAuth callback server did not accept connections on port ${port}`))
    })
    socket.once("connect", () => {
      finish()
    })
    socket.once("error", (error) => {
      finish(error)
    })
  })
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
    const url = new URL(request.url ?? "/", "http://127.0.0.1")

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
  try {
    await waitForServerReady(activePort)
  } catch (error) {
    clearTimeout(timeoutId)
    server.close()
    throw error
  }

  return {
    port: activePort,
    waitForCallback: () => callbackPromise,
    close: () => {
      clearTimeout(timeoutId)
      server.close()
    },
  }
}
