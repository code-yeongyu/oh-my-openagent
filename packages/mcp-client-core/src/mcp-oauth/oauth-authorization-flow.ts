import { spawn, type ChildProcess } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Socket } from "node:net"

export type OAuthCallbackResult = {
  code: string
  state: string
}

export type OAuthBrowserOpener = (authorizationUrl: string) => void | Promise<void>

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

// Spawn failures such as ENOENT surface asynchronously on the child process.
// A short grace window lets that error reject the open attempt instead of
// reporting a successful dispatch that never happened. Browsers detach
// immediately, so waiting for process exit would misreport success.
const OPEN_DISPATCH_GRACE_MS = 100

type CallbackServerHandle = {
  waitForCallback: () => Promise<OAuthCallbackResult>
  close: () => Promise<void>
}

export function startCallbackServer(port: number): Promise<CallbackServerHandle> {
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let resolveCallback: ((result: OAuthCallbackResult) => void) | null = null
    let rejectCallback: ((error: Error) => void) | null = null
    const openSockets = new Set<Socket>()

    const callbackPromise = new Promise<OAuthCallbackResult>((res, rej) => {
      resolveCallback = res
      rejectCallback = rej
    })

    const clearCallbackTimeout = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    const closeServer = async (): Promise<void> => {
      clearCallbackTimeout()
      if (!server.listening) {
        return
      }
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose())
        for (const socket of openSockets) {
          socket.destroy()
        }
      })
    }

    const onServerError = (err: Error): void => {
      clearCallbackTimeout()
      reject(err)
    }

    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const requestUrl = new URL(request.url ?? "/", `http://localhost:${port}`)
      const code = requestUrl.searchParams.get("code")
      const state = requestUrl.searchParams.get("state")
      const error = requestUrl.searchParams.get("error")

      if (error) {
        const errorDescription = requestUrl.searchParams.get("error_description") ?? error
        response.writeHead(400, { "content-type": "text/html" })
        response.end("<html><body><h1>Authorization failed</h1></body></html>")
        clearCallbackTimeout()
        rejectCallback?.(new Error(`OAuth authorization error: ${errorDescription}`))
        void closeServer()
        return
      }

      if (!code || !state) {
        response.writeHead(400, { "content-type": "text/html" })
        response.end("<html><body><h1>Missing code or state</h1></body></html>")
        clearCallbackTimeout()
        rejectCallback?.(new Error("OAuth callback missing code or state parameter"))
        void closeServer()
        return
      }

      response.writeHead(200, { "content-type": "text/html" })
      response.end("<html><body><h1>Authorization successful. You can close this tab.</h1></body></html>")
      clearCallbackTimeout()
      resolveCallback?.({ code, state })
      void closeServer()
    })

    timeoutId = setTimeout(() => {
      rejectCallback?.(new Error("OAuth callback timed out after 5 minutes"))
      void closeServer()
    }, CALLBACK_TIMEOUT_MS)

    server.once("error", onServerError)

    server.once("listening", () => {
      server.off("error", onServerError)
      resolve({
        waitForCallback: () => callbackPromise,
        close: closeServer,
      })
    })

    server.on("connection", (socket: Socket) => {
      openSockets.add(socket)
      socket.once("close", () => {
        openSockets.delete(socket)
      })
    })

    server.listen(port, "127.0.0.1")
  })
}

function platformBrowserCommand(url: string): { command: string; args: string[] } {
  const platform = process.platform

  if (platform === "darwin") {
    return { command: "open", args: [url] }
  }
  if (platform === "win32") {
    return { command: "explorer", args: [url] }
  }
  return { command: "xdg-open", args: [url] }
}

function openInPlatformBrowser(url: string): Promise<void> {
  const { command, args } = platformBrowserCommand(url)

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    let settled = false
    child.once("error", (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    })

    setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.unref()
      resolve()
    }, OPEN_DISPATCH_GRACE_MS)
  })
}

export async function runAuthorizationCodeRedirect(options: {
  authorizationEndpoint: string
  callbackPort: number
  clientId: string
  redirectUri: string
  scopes?: string[]
  resource?: string
  openBrowser?: OAuthBrowserOpener
}): Promise<{ code: string; verifier: string; authorizationUrl: string }> {
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

  const callbackServer = await startCallbackServer(options.callbackPort)

  try {
    await (options.openBrowser ?? openInPlatformBrowser)(authorizationUrl)
  } catch (error) {
    await callbackServer.close()
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to open browser for OAuth authorization (${reason}). Open the URL manually: ${authorizationUrl}`,
    )
  }

  try {
    const result = await callbackServer.waitForCallback()
    if (result.state !== state) {
      throw new Error("OAuth state mismatch")
    }

    return { code: result.code, verifier, authorizationUrl }
  } finally {
    await callbackServer.close()
  }
}
