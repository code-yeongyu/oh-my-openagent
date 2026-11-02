import type { OAuthTokenData } from "./storage"
import { deleteToken, loadToken, saveToken } from "./storage"
import { PLUGIN_NAME } from "../plugin-identity"
import { discoverOAuthServerMetadata } from "./discovery"
import type { OAuthServerMetadata } from "./discovery"
import { getOrRegisterClient } from "./dcr"
import type { ClientCredentials, ClientRegistrationStorage } from "./dcr"
import { findAvailablePort } from "./callback-server"
import {
  buildAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  runAuthorizationCodeRedirect,
} from "./oauth-authorization-flow"

export type McpOAuthProviderOptions = {
  serverUrl: string
  clientId?: string
  scopes?: string[]
}

async function parseTokenResponse(tokenResponse: Response): Promise<Record<string, unknown>> {
  if (!tokenResponse.ok) {
    let errorDetail = `${tokenResponse.status}`
    try {
      const body = (await tokenResponse.json()) as Record<string, unknown>
      if (body["error"]) {
        errorDetail = `${tokenResponse.status} ${body["error"]}`
        if (body["error_description"]) {
          errorDetail += `: ${body["error_description"]}`
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
    throw new Error(`Token exchange failed: ${errorDetail}`)
  }

  return (await tokenResponse.json()) as Record<string, unknown>
}

function buildOAuthTokenData(
  tokenData: Record<string, unknown>,
  clientInfo: ClientCredentials,
  fallbackRefreshToken?: string,
): OAuthTokenData {
  const accessToken = tokenData["access_token"]
  if (typeof accessToken !== "string") {
    throw new Error("Token response missing access_token")
  }

  return {
    ...(clientInfo.issuer ? { issuer: clientInfo.issuer } : {}),
    accessToken,
    refreshToken: typeof tokenData["refresh_token"] === "string" ? tokenData["refresh_token"] : fallbackRefreshToken,
    expiresAt:
      typeof tokenData["expires_in"] === "number" ? Math.floor(Date.now() / 1000) + tokenData["expires_in"] : undefined,
    clientInfo: {
      ...(clientInfo.issuer ? { issuer: clientInfo.issuer } : {}),
      clientId: clientInfo.clientId,
      ...(clientInfo.clientSecret ? { clientSecret: clientInfo.clientSecret } : {}),
    },
  }
}

export class McpOAuthProvider {
  private readonly serverUrl: string
  private readonly configClientId: string | undefined
  private readonly scopes: string[]
  private storedCodeVerifier: string | null = null
  private storedClientInfo: ClientCredentials | null = null
  private callbackPort: number | null = null
  private issuer: string | undefined

  constructor(options: McpOAuthProviderOptions) {
    this.serverUrl = options.serverUrl
    this.configClientId = options.clientId
    this.scopes = options.scopes ?? []
  }

  tokens(): OAuthTokenData | null {
    return loadToken(this.serverUrl, this.serverUrl)
  }

  saveTokens(tokenData: OAuthTokenData): boolean {
    const issuer = tokenData.issuer ?? this.issuer
    return saveToken(this.serverUrl, this.serverUrl, issuer ? {
      ...tokenData,
      issuer,
      ...(tokenData.clientInfo ? { clientInfo: { ...tokenData.clientInfo, issuer: tokenData.clientInfo.issuer ?? issuer } } : {}),
    } : tokenData)
  }

  private bindIssuer(issuer: string): boolean {
    const token = this.tokens()
    const stamps = [token?.issuer, token?.clientInfo?.issuer, this.storedClientInfo?.issuer, this.issuer]
    const changed = stamps.some((stamp) => stamp !== undefined && stamp !== issuer)
    if (changed) {
      this.storedClientInfo = null
      this.storedCodeVerifier = null
      if (!deleteToken(this.serverUrl, this.serverUrl)) {
        throw new Error("Unable to discard credentials for the previous OAuth issuer")
      }
    }
    this.issuer = issuer
    if (!changed && token && !this.saveTokens(token)) {
      throw new Error("Unable to stamp stored OAuth credentials with their issuer")
    }
    const clientInfo = this.clientInformation()
    if (clientInfo) this.storedClientInfo = { ...clientInfo, issuer }
    return changed
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

  async redirectToAuthorization(metadata: OAuthServerMetadata): Promise<{ code: string }> {
    const clientInfo = this.clientInformation()
    if (!clientInfo) {
      throw new Error("No client information available. Run login() or register a client first.")
    }

    if (this.callbackPort === null) {
      this.callbackPort = await findAvailablePort()
    }

    const result = await runAuthorizationCodeRedirect({
      issuer: metadata.issuer,
      authorizationResponseIssParameterSupported: metadata.authorizationResponseIssParameterSupported,
      authorizationEndpoint: metadata.authorizationEndpoint,
      callbackPort: this.callbackPort,
      clientId: clientInfo.clientId,
      redirectUri: this.redirectUrl(),
      scopes: this.scopes,
      resource: metadata.resource,
    })

    this.saveCodeVerifier(result.verifier)
    return { code: result.code }
  }

  async login(): Promise<OAuthTokenData> {
    const metadata = await discoverOAuthServerMetadata(this.serverUrl, true)
    this.bindIssuer(metadata.issuer)
    if (this.callbackPort === null) this.callbackPort = await findAvailablePort()

    const clientRegistrationStorage: ClientRegistrationStorage = {
      getClientRegistration: () => this.storedClientInfo,
      setClientRegistration: (_serverIdentifier: string, credentials: ClientCredentials) => {
        this.storedClientInfo = { ...credentials, issuer: metadata.issuer }
      },
    }

    const clientInfo = await getOrRegisterClient({
      ...(metadata.registrationEndpoint ? { registrationEndpoint: metadata.registrationEndpoint } : {}),
      serverIdentifier: metadata.issuer,
      clientName: PLUGIN_NAME,
      redirectUris: [this.redirectUrl()],
      tokenEndpointAuthMethod: "none",
      ...(this.configClientId ? { clientId: this.configClientId } : {}),
      storage: clientRegistrationStorage,
    })

    if (!clientInfo) {
      throw new Error("Failed to obtain client credentials. Provide a clientId or ensure the server supports DCR.")
    }

    this.storedClientInfo = { ...clientInfo, issuer: metadata.issuer }

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

    const tokenData = await parseTokenResponse(tokenResponse)
    const oauthTokenData = buildOAuthTokenData(tokenData, { ...clientInfo, issuer: metadata.issuer })

    this.saveTokens(oauthTokenData)
    return oauthTokenData
  }

  async refresh(refreshToken: string): Promise<OAuthTokenData> {
    const metadata = await discoverOAuthServerMetadata(this.serverUrl, true)
    if (this.bindIssuer(metadata.issuer)) return this.login()
    const clientInfo = this.clientInformation()
    const clientId = clientInfo?.clientId ?? this.configClientId
    if (!clientId) {
      throw new Error("No client information available. Run login() or register a client first.")
    }

    const tokenResponse = await fetch(metadata.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        ...(clientInfo?.clientSecret ? { client_secret: clientInfo.clientSecret } : {}),
        ...(metadata.resource ? { resource: metadata.resource } : {}),
      }).toString(),
    })

    const tokenData = await parseTokenResponse(tokenResponse)
    const oauthTokenData = buildOAuthTokenData(tokenData, {
      clientId,
      issuer: metadata.issuer,
      ...(clientInfo?.clientSecret ? { clientSecret: clientInfo.clientSecret } : {}),
    }, refreshToken)

    this.saveTokens(oauthTokenData)
    return oauthTokenData
  }
}

export { generateCodeVerifier, generateCodeChallenge, buildAuthorizationUrl }
