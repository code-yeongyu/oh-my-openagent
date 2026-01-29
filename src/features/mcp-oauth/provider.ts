import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import type { OAuthTokenData } from "./storage"
import { loadToken, saveToken } from "./storage"
import { discoverOAuthServerMetadata } from "./discovery"
import type { OAuthServerMetadata } from "./discovery"
import { getOrRegisterClient } from "./dcr"
import type { ClientCredentials, ClientRegistrationStorage } from "./dcr"
import { findAvailablePort } from "./callback-server"

export type McpOAuthProviderOptions = {
  serverUrl: string
  clientId?: string
  scopes?: string[]
}

type CallbackResult = {
  code: string
  state: string
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

function buildAuthorizationUrl(
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

function startCallbackServer(port: number): Promise<CallbackResult> {
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
  let cmd: string
  let args: string[]

  if (platform === "darwin") {
    cmd = "open"
    args = [url]
  } else if (platform === "win32") {
    cmd = "explorer"
    args = [url]
  } else {
    cmd = "xdg-open"
    args = [url]
  }

  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true })
    child.on("error", () => {})
    child.unref()
  } catch {
    // Browser open failed — user must navigate manually
  }
}

export class McpOAuthProvider {
  private readonly serverUrl: string
  private readonly configClientId: string | undefined
  private readonly scopes: string[]
  private storedCodeVerifier: string | null = null
  private storedClientInfo: ClientCredentials | null = null
  private callbackPort: number | null = null

  constructor(options: McpOAuthProviderOptions) {
    this.serverUrl = options.serverUrl
    this.configClientId = options.clientId
    this.scopes = options.scopes ?? []
  }

  tokens(): OAuthTokenData | null {
    return loadToken(this.serverUrl, this.serverUrl)
  }

  saveTokens(tokenData: OAuthTokenData): boolean {
    return saveToken(this.serverUrl, this.serverUrl, tokenData)
  }

  clientInformation(): ClientCredentials | null {
    if (this.storedClientInfo) return this.storedClientInfo
    const tokenData = this.tokens()
    if (tokenData?.clientInfo) {
      this.storedClientInfo = tokenData.clientInfo
      return this.storedClientInfo
    }
    return null
  }

  redirectUrl(): string {
    return `http://127.0.0.1:${this.callbackPort ?? 19877}/callback`
  }

  saveCodeVerifier(verifier: string): void {
    this.storedCodeVerifier = verifier
  }

  codeVerifier(): string | null {
    return this.storedCodeVerifier
  }

  async redirectToAuthorization(metadata: OAuthServerMetadata): Promise<CallbackResult> {
    const verifier = generateCodeVerifier()
    this.saveCodeVerifier(verifier)
    const challenge = generateCodeChallenge(verifier)
    const state = randomBytes(16).toString("hex")

    const clientInfo = this.clientInformation()
    if (!clientInfo) {
      throw new Error("No client information available. Run login() or register a client first.")
    }

    if (this.callbackPort === null) {
      this.callbackPort = await findAvailablePort()
    }

    const authUrl = buildAuthorizationUrl(metadata.authorizationEndpoint, {
      clientId: clientInfo.clientId,
      redirectUri: this.redirectUrl(),
      codeChallenge: challenge,
      state,
      scopes: this.scopes,
      resource: metadata.resource,
    })

    const callbackPromise = startCallbackServer(this.callbackPort)
    openBrowser(authUrl)

    const result = await callbackPromise
    if (result.state !== state) {
      throw new Error("OAuth state mismatch")
    }

    return result
  }

  async login(): Promise<OAuthTokenData> {
    const metadata = await discoverOAuthServerMetadata(this.serverUrl)

    const clientRegistrationStorage: ClientRegistrationStorage = {
      getClientRegistration: () => this.storedClientInfo,
      setClientRegistration: (_serverIdentifier: string, credentials: ClientCredentials) => {
        this.storedClientInfo = credentials
      },
    }

    const clientInfo = await getOrRegisterClient({
      registrationEndpoint: metadata.registrationEndpoint,
      serverIdentifier: this.serverUrl,
      clientName: "oh-my-opencode",
      redirectUris: [this.redirectUrl()],
      tokenEndpointAuthMethod: "none",
      clientId: this.configClientId,
      storage: clientRegistrationStorage,
    })

    if (!clientInfo) {
      throw new Error("Failed to obtain client credentials. Provide a clientId or ensure the server supports DCR.")
    }

    this.storedClientInfo = clientInfo

    const { code } = await this.redirectToAuthorization(metadata)
    const verifier = this.codeVerifier()
    if (!verifier) {
      throw new Error("Code verifier not found")
    }

    const tokenResponse = await fetch(metadata.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUrl(),
        client_id: clientInfo.clientId,
        code_verifier: verifier,
        ...(metadata.resource ? { resource: metadata.resource } : {}),
      }).toString(),
    })

    if (!tokenResponse.ok) {
      let errorDetail = `${tokenResponse.status}`
      try {
        const body = (await tokenResponse.json()) as Record<string, unknown>
        if (body.error) {
          errorDetail = `${tokenResponse.status} ${body.error}`
          if (body.error_description) {
            errorDetail += `: ${body.error_description}`
          }
        }
      } catch {
        // Response body not JSON
      }
      throw new Error(`Token exchange failed: ${errorDetail}`)
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>
    const accessToken = tokenData.access_token
    if (typeof accessToken !== "string") {
      throw new Error("Token response missing access_token")
    }

    const oauthTokenData: OAuthTokenData = {
      accessToken,
      refreshToken: typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : undefined,
      expiresAt:
        typeof tokenData.expires_in === "number" ? Math.floor(Date.now() / 1000) + tokenData.expires_in : undefined,
      clientInfo: {
        clientId: clientInfo.clientId,
        clientSecret: clientInfo.clientSecret,
      },
    }

    this.saveTokens(oauthTokenData)
    return oauthTokenData
  }
}

export { generateCodeVerifier, generateCodeChallenge, buildAuthorizationUrl, startCallbackServer }
