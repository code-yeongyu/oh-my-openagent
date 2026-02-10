const DEFAULT_PORT = 19877
const MAX_PORT_ATTEMPTS = 20
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

async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => new Response(),
    })
    server.stop(true)
    return true
  } catch {
    return false
  }
}

export async function findAvailablePort(startPort: number = DEFAULT_PORT): Promise<number> {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = startPort + attempt
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + MAX_PORT_ATTEMPTS - 1}`)
}

export async function startCallbackServer(startPort: number = DEFAULT_PORT): Promise<CallbackServer> {
  const port = await findAvailablePort(startPort)

  let resolveCallback: ((result: OAuthCallbackResult) => void) | null = null
  let rejectCallback: ((error: Error) => void) | null = null

  const callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  const timeoutId = setTimeout(() => {
    rejectCallback?.(new Error("OAuth callback timed out after 5 minutes"))
    server.stop(true)
  }, TIMEOUT_MS)

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(request: Request): Response {
      const url = new URL(request.url)

      if (url.pathname !== "/oauth/callback") {
        return new Response("Not Found", { status: 404 })
      }

      const oauthError = url.searchParams.get("error")
      if (oauthError) {
        const description = url.searchParams.get("error_description") ?? oauthError
        clearTimeout(timeoutId)
        rejectCallback?.(new Error(`OAuth authorization failed: ${description}`))
        setTimeout(() => server.stop(true), 100)
        return new Response(`Authorization failed: ${description}`, { status: 400 })
      }

      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")

      if (!code || !state) {
        clearTimeout(timeoutId)
        rejectCallback?.(new Error("OAuth callback missing code or state parameter"))
        setTimeout(() => server.stop(true), 100)
        return new Response("Missing code or state parameter", { status: 400 })
      }

      resolveCallback?.({ code, state })
      clearTimeout(timeoutId)

      setTimeout(() => server.stop(true), 100)

      return new Response(SUCCESS_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    },
  })

  return {
    port,
    waitForCallback: () => callbackPromise,
    close: () => {
      clearTimeout(timeoutId)
      server.stop(true)
    },
  }
}
