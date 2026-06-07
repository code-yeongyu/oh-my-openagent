import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http"
import { clearTimeout, setTimeout } from "node:timers"

import { log } from "../../shared/logger"
import { findAvailablePort as findAvailablePortShared } from "../../shared/port-utils"

const DEFAULT_PORT = 19877
const TIMEOUT_MS = 5 * 60 * 1000
const STARTUP_TIMEOUT_MS = 2_000
const STARTUP_RETRY_MS = 25

export type OAuthCallbackResult = {
  code: string
  state: string
}

export type CallbackServer = {
  port: number
  waitForCallback: () => Promise<OAuthCallbackResult>
  close: () => Promise<void>
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

function isServerNotRunningError(error: Error): boolean {
  return "code" in error && error.code === "ERR_SERVER_NOT_RUNNING"
}

export async function findAvailablePort(startPort: number = DEFAULT_PORT): Promise<number> {
  return findAvailablePortShared(startPort)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function probeServerReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false

    const finish = (ready: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(ready)
    }

    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        method: "GET",
        path: "/__omo_oauth_ready__",
        port,
      },
      (response) => {
        response.resume()
        response.once("end", () => {
          finish(true)
        })
        response.once("error", () => {
          finish(false)
        })
      },
    )

    req.setTimeout(STARTUP_RETRY_MS, () => {
      req.destroy()
      finish(false)
    })
    req.once("error", () => {
      finish(false)
    })
    req.end()
  })
}

async function waitForServerReady(port: number): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= STARTUP_TIMEOUT_MS) {
    if (await probeServerReady(port)) {
      return
    }
    await delay(STARTUP_RETRY_MS)
  }

  throw new Error(`OAuth callback server did not accept HTTP requests on port ${port}`)
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
    scheduleClose()
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
      setTimeout(scheduleClose, 100)
      return
    }

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")

    if (!code || !state) {
      clearTimeout(timeoutId)
      rejectCallback?.(new Error("OAuth callback missing code or state parameter"))
      response.statusCode = 400
      response.end("Missing code or state parameter")
      setTimeout(scheduleClose, 100)
      return
    }

    resolveCallback?.({ code, state })
    clearTimeout(timeoutId)

    response.statusCode = 200
    response.setHeader("content-type", "text/html; charset=utf-8")
    response.end(SUCCESS_HTML)
    setTimeout(scheduleClose, 100)
  })

  let closePromise: Promise<void> | null = null

  function scheduleClose(): void {
    void closeServer().catch((error) => {
      log("Failed to close OAuth callback server", error)
    })
  }

  function closeServer(): Promise<void> {
    clearTimeout(timeoutId)

    if (closePromise) {
      return closePromise
    }

    if (!server.listening) {
      closePromise = Promise.resolve()
      return closePromise
    }

    closePromise = new Promise((resolve) => {
      try {
        server.close(() => {
          resolve()
        })
      } catch (error) {
        if (!(error instanceof Error) || !isServerNotRunningError(error)) {
          throw error
        }
        resolve()
      }
    })

    return closePromise
  }

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
    await closeServer()
    throw error
  }

  return {
    port: activePort,
    waitForCallback: () => callbackPromise,
    close: closeServer,
  }
}
