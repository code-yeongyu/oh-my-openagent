import type { CheckResult, CheckDefinition } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import { getMcpOauthStoragePath } from "../../../features/mcp-oauth/storage"
import { existsSync, readFileSync } from "node:fs"

interface OAuthTokenData {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  clientInfo?: {
    clientId: string
    clientSecret?: string
  }
}

type TokenStore = Record<string, OAuthTokenData>

export function readTokenStore(): TokenStore | null {
  const filePath = getMcpOauthStoragePath()
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as TokenStore
  } catch {
    return null
  }
}

export async function checkMcpOAuthTokens(): Promise<CheckResult> {
  const store = readTokenStore()

  if (!store || Object.keys(store).length === 0) {
    return {
      name: CHECK_NAMES[CHECK_IDS.MCP_OAUTH_TOKENS],
      status: "skip",
      message: "No OAuth tokens configured",
      details: ["Optional: Configure OAuth tokens for MCP servers"],
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const tokens = Object.entries(store)
  const expiredTokens = tokens.filter(
    ([, token]) => token.expiresAt && token.expiresAt < now
  )

  if (expiredTokens.length > 0) {
    return {
      name: CHECK_NAMES[CHECK_IDS.MCP_OAUTH_TOKENS],
      status: "warn",
      message: `${expiredTokens.length} of ${tokens.length} token(s) expired`,
      details: [
        ...tokens
          .filter(([, token]) => !token.expiresAt || token.expiresAt >= now)
          .map(([key]) => `Valid: ${key}`),
        ...expiredTokens.map(([key]) => `Expired: ${key}`),
      ],
    }
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.MCP_OAUTH_TOKENS],
    status: "pass",
    message: `${tokens.length} OAuth token(s) valid`,
    details: tokens.map(([key]) => `Configured: ${key}`),
  }
}

export function getMcpOAuthCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.MCP_OAUTH_TOKENS,
    name: CHECK_NAMES[CHECK_IDS.MCP_OAUTH_TOKENS],
    category: "tools",
    check: checkMcpOAuthTokens,
    critical: false,
  }
}
