import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createConnection } from "node:net"
import { clearTimeout as clearNativeTimeout, setTimeout as setNativeTimeout } from "node:timers"

import { findAvailablePort as findAvailablePortShared } from "@oh-my-opencode/utils"
import { log } from "../logger"

const DEFAULT_PORT = 19877
const TIMEOUT_MS = 5 * 60 * 1000
const STARTUP_TIMEOUT_MS = 2_000
const STARTUP_PROBE_TIMEOUT_MS = 250
const STARTUP_RETRY_MS = 25
const READINESS_PROBE_PATH = "/__omo_oauth_startup_probe__"

export type OAuthCallbackResult = {
  code: string
  state: string
}

export type CallbackServer = {
  port: number
  waitForCallback: () => Promise<OAuthCallbackResult>
  close: () => Promise<void>
}

export type CallbackServerTimerHandle = ReturnType<typeof setNativeTimeout>
export type CallbackServerTimer = {
  readonly setTimeout: (callback: () => void, delayMs: number) => CallbackServerTimerHandle
  readonly clearTimeout: (handle: CallbackServerTimerHandle) => void
}

const CALLBACK_SERVER_TIMER: CallbackServerTimer = {
  setTimeout: (callback, delayMs) => setNativeTimeout(callback, delayMs),
  clearTimeout: (handle) => clearNativeTimeout(handle),
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
    setNativeTimeout(() => resolve(), ms)
  })
}

function probeServerAcceptingHttpRequests(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let receivedResponse = false

    const finish = (ready: boolean, destroySocket: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      if (destroySocket) {
        socket.destroy()
      }
      resolve(ready)
    }

    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        `GET ${READINESS_PROBE_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      )
    })
    socket.once("data", () => {
      receivedResponse = true
    })
    socket.once("end", () => {
      finish(receivedResponse, false)
    })
    socket.once("close", () => {
      finish(receivedResponse, false)
    })

    socket.setTimeout(STARTUP_PROBE_TIMEOUT_MS, () => {
      finish(false, true)
    })
    socket.once("error", () => {
      finish(false, true)
    })
  })
}

async function waitForServerAcceptingHttpRequests(port: number): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= STARTUP_TIMEOUT_MS) {
    if (await probeServerAcceptingHttpRequests(port)) {
      return
    }
    await delay(STARTUP_RETRY_MS)
  }

  throw new Error(`OAuth callback server did not accept HTTP requests on port ${port}`)
}

export async function startCallbackServer(
  startPort: number = DEFAULT_PORT,
  options: { readonly timer?: CallbackServerTimer } = {},
): Promise<CallbackServer> {
  const requestedPort = startPort === 0 ? 0 : await findAvailablePort(startPort).catch(() => 0)
  const timer = options.timer ?? CALLBACK_SERVER_TIMER

  let resolveCallback: ((result: OAuthCallbackResult) => void) | null = null
  let rejectCallback: ((error: Error) => void) | null = null

  const callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  const timeoutId = timer.setTimeout(() => {
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
      timer.clearTimeout(timeoutId)
      rejectCallback?.(new Error(`OAuth authorization failed: ${description}`))
      response.statusCode = 400
      response.end(`Authorization failed: ${description}`)
      timer.setTimeout(scheduleClose, 100)
      return
    }

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")

    if (!code || !state) {
      timer.clearTimeout(timeoutId)
      rejectCallback?.(new Error("OAuth callback missing code or state parameter"))
      response.statusCode = 400
      response.end("Missing code or state parameter")
      timer.setTimeout(scheduleClose, 100)
      return
    }

    resolveCallback?.({ code, state })
    timer.clearTimeout(timeoutId)

    response.statusCode = 200
    response.setHeader("content-type", "text/html; charset=utf-8")
    response.end(SUCCESS_HTML)
    timer.setTimeout(scheduleClose, 100)
  })

  let closePromise: Promise<void> | null = null

  function scheduleClose(): void {
    void closeServer().catch((error) => {
      log("Failed to close OAuth callback server", error)
    })
  }

  function closeServer(): Promise<void> {
    timer.clearTimeout(timeoutId)

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
      timer.clearTimeout(timeoutId)
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
    await waitForServerAcceptingHttpRequests(activePort)
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
