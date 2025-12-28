import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_TOKEN_REFRESH_BUFFER_MS,
  GOOGLE_TOKEN_URL,
} from "./constants"
import type {
  AntigravityRefreshParts,
  AntigravityTokenExchangeResult,
  AntigravityTokens,
  OAuthErrorPayload,
  ParsedOAuthError,
} from "./types"

export class AntigravityTokenRefreshError extends Error {
  code?: string
  description?: string
  status: number
  statusText: string
  responseBody?: string

  constructor(options: {
    message: string
    code?: string
    description?: string
    status: number
    statusText: string
    responseBody?: string
  }) {
    super(options.message)
    this.name = "AntigravityTokenRefreshError"
    this.code = options.code
    this.description = options.description
    this.status = options.status
    this.statusText = options.statusText
    this.responseBody = options.responseBody
  }

  get isInvalidGrant(): boolean {
    return this.code === "invalid_grant"
  }

  get isNetworkError(): boolean {
    return this.status === 0
  }
}

function parseOAuthErrorPayload(text: string | undefined): ParsedOAuthError {
  if (!text) {
    return {}
  }

  try {
    const payload = JSON.parse(text) as OAuthErrorPayload
    let code: string | undefined

    if (typeof payload.error === "string") {
      code = payload.error
    } else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status ?? payload.error.code
    }

    return {
      code,
      description: payload.error_description,
    }
  } catch {
    return { description: text }
  }
}

export function isTokenExpired(tokens: AntigravityTokens): boolean {
  const expirationTime = tokens.timestamp + tokens.expires_in * 1000
  return Date.now() >= expirationTime - ANTIGRAVITY_TOKEN_REFRESH_BUFFER_MS
}

const MAX_REFRESH_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000

function calculateRetryDelay(attempt: number): number {
  return Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt), 10000)
}

function isRetryableError(status: number): boolean {
  if (status === 0) return true
  if (status === 429) return true
  if (status >= 500 && status < 600) return true
  return false
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string = ANTIGRAVITY_CLIENT_ID,
  clientSecret: string = ANTIGRAVITY_CLIENT_SECRET
): Promise<AntigravityTokenExchangeResult> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  let lastError: AntigravityTokenRefreshError | undefined

  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      })

      if (response.ok) {
        const data = (await response.json()) as {
          access_token: string
          refresh_token?: string
          expires_in: number
          token_type: string
        }

        return {
          access_token: data.access_token,
          refresh_token: data.refresh_token || refreshToken,
          expires_in: data.expires_in,
          token_type: data.token_type,
        }
      }

      const responseBody = await response.text().catch(() => undefined)
      const parsed = parseOAuthErrorPayload(responseBody)

      lastError = new AntigravityTokenRefreshError({
        message: parsed.description || `Token refresh failed: ${response.status} ${response.statusText}`,
        code: parsed.code,
        description: parsed.description,
        status: response.status,
        statusText: response.statusText,
        responseBody,
      })

      if (parsed.code === "invalid_grant") {
        throw lastError
      }

      if (!isRetryableError(response.status)) {
        throw lastError
      }

      if (attempt < MAX_REFRESH_RETRIES) {
        const delay = calculateRetryDelay(attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    } catch (error) {
      if (error instanceof AntigravityTokenRefreshError) {
        throw error
      }

      lastError = new AntigravityTokenRefreshError({
        message: error instanceof Error ? error.message : "Network error during token refresh",
        status: 0,
        statusText: "Network Error",
      })

      if (attempt < MAX_REFRESH_RETRIES) {
        const delay = calculateRetryDelay(attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new AntigravityTokenRefreshError({
    message: "Token refresh failed after all retries",
    status: 0,
    statusText: "Max Retries Exceeded",
  })
}

/**
 * Parse a stored token string into its component parts.
 * Storage format: `refreshToken|projectId|managedProjectId`
 *
 * @param stored - The pipe-separated stored token string
 * @returns Parsed refresh parts with refreshToken, projectId, and optional managedProjectId
 */
export function parseStoredToken(stored: string): AntigravityRefreshParts {
  const parts = stored.split("|")
  const [refreshToken, projectId, managedProjectId] = parts

  return {
    refreshToken: refreshToken || "",
    projectId: projectId || undefined,
    managedProjectId: managedProjectId || undefined,
  }
}

/**
 * Format token components for storage.
 * Creates a pipe-separated string: `refreshToken|projectId|managedProjectId`
 *
 * @param refreshToken - The refresh token
 * @param projectId - The GCP project ID
 * @param managedProjectId - Optional managed project ID for enterprise users
 * @returns Formatted string for storage
 */
export function formatTokenForStorage(
  refreshToken: string,
  projectId: string,
  managedProjectId?: string
): string {
  return `${refreshToken}|${projectId}|${managedProjectId || ""}`
}
