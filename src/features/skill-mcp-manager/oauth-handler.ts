import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"
import { McpOAuthProvider } from "../mcp-oauth/provider"
import type { OAuthTokenData } from "../mcp-oauth/storage"
import { isStepUpRequired, mergeScopes } from "../mcp-oauth/step-up"
import type { OAuthProviderFactory, OAuthProviderLike } from "./types"

export function getOrCreateAuthProvider(
  authProviders: Map<string, OAuthProviderLike>,
  serverUrl: string,
  oauth: NonNullable<ClaudeCodeMcpServer["oauth"]>,
  createOAuthProvider: OAuthProviderFactory = (options) => new McpOAuthProvider(options),
): OAuthProviderLike {
  const existing = authProviders.get(serverUrl)
  if (existing) return existing

  const provider = createOAuthProvider({
    serverUrl,
    clientId: oauth.clientId,
    scopes: oauth.scopes,
  })
  authProviders.set(serverUrl, provider)
  return provider
}

function isTokenExpired(tokenData: OAuthTokenData): boolean {
  if (tokenData.expiresAt == null) return false
  return tokenData.expiresAt < Math.floor(Date.now() / 1000)
}

export async function buildHttpRequestInit(
  config: ClaudeCodeMcpServer,
  authProviders: Map<string, OAuthProviderLike>,
  createOAuthProvider?: OAuthProviderFactory,
): Promise<RequestInit | undefined> {
  const headers: Record<string, string> = {}

  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = value
    }
  }

  if (config.oauth && config.url) {
    const provider = getOrCreateAuthProvider(authProviders, config.url, config.oauth, createOAuthProvider)
    let tokenData = provider.tokens()

    if (!tokenData || isTokenExpired(tokenData)) {
      try {
        tokenData = await provider.login()
      } catch {
        tokenData = null
      }
    }

    if (tokenData) {
      headers.Authorization = `Bearer ${tokenData.accessToken}`
    }
  }

  return Object.keys(headers).length > 0 ? { headers } : undefined
}

export async function handleStepUpIfNeeded(params: {
  error: Error
  config: ClaudeCodeMcpServer
  authProviders: Map<string, OAuthProviderLike>
  createOAuthProvider?: OAuthProviderFactory
}): Promise<boolean> {
  const { error, config, authProviders, createOAuthProvider } = params

  if (!config.oauth || !config.url) {
    return false
  }

  const statusMatch = /\b403\b/.exec(error.message)
  if (!statusMatch) {
    return false
  }

  const headers: Record<string, string> = {}
  const wwwAuthMatch = /WWW-Authenticate:\s*(.+)/i.exec(error.message)
  if (wwwAuthMatch?.[1]) {
    headers["www-authenticate"] = wwwAuthMatch[1]
  }

  const stepUp = isStepUpRequired(403, headers)
  if (!stepUp) {
    return false
  }

  const currentScopes = config.oauth.scopes ?? []
  const mergedScopes = mergeScopes(currentScopes, stepUp.requiredScopes)
  config.oauth.scopes = mergedScopes

  authProviders.delete(config.url)
  const provider = getOrCreateAuthProvider(authProviders, config.url, config.oauth, createOAuthProvider)

  try {
    await provider.login()
    return true
  } catch {
    return false
  }
}
