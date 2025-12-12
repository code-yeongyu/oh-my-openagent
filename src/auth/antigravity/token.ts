/**
 * Antigravity token management utilities.
 * Handles token expiration checking, refresh, and storage format parsing.
 */

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
} from "./types"

/**
 * Check if the access token is expired.
 * Includes a 60-second safety buffer to refresh before actual expiration.
 *
 * @param tokens - The Antigravity tokens to check
 * @returns true if the token is expired or will expire within the buffer period
 */
export function isTokenExpired(tokens: AntigravityTokens): boolean {
  // Calculate when the token expires (timestamp + expires_in in ms)
  // timestamp is in milliseconds, expires_in is in seconds
  const expirationTime = tokens.timestamp + tokens.expires_in * 1000

  // Check if current time is past (expiration - buffer)
  return Date.now() >= expirationTime - ANTIGRAVITY_TOKEN_REFRESH_BUFFER_MS
}

/**
 * Refresh an access token using a refresh token.
 * Exchanges the refresh token for a new access token via Google's OAuth endpoint.
 *
 * @param refreshToken - The refresh token to use
 * @param clientId - Optional custom client ID (defaults to ANTIGRAVITY_CLIENT_ID)
 * @param clientSecret - Optional custom client secret (defaults to ANTIGRAVITY_CLIENT_SECRET)
 * @returns Token exchange result with new access token, or throws on error
 */
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

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`
    )
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
  }

  return {
    access_token: data.access_token,
    // Google may return a new refresh token, fall back to the original
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
    token_type: data.token_type,
  }
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
