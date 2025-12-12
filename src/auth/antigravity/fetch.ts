/**
 * Antigravity Fetch Interceptor
 *
 * Creates a custom fetch function that:
 * - Checks token expiration and auto-refreshes
 * - Rewrites URLs to Antigravity endpoints
 * - Applies request transformation (including tool normalization)
 * - Applies response transformation (including thinking extraction)
 * - Implements endpoint fallback (daily → autopush → prod)
 *
 * Debug logging available via ANTIGRAVITY_DEBUG=1 environment variable.
 */

import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from "./constants"
import { fetchProjectContext, clearProjectContextCache } from "./project"
import { isTokenExpired, refreshAccessToken, parseStoredToken, formatTokenForStorage } from "./token"
import { transformRequest } from "./request"
import { transformResponse, transformStreamingResponse, isStreamingResponse } from "./response"
import { normalizeToolsForGemini, type OpenAITool } from "./tools"
import { extractThinkingBlocks, shouldIncludeThinking, transformResponseThinking } from "./thinking"
import type { AntigravityTokens } from "./types"

/**
 * Auth interface matching OpenCode's auth system
 */
interface Auth {
  access?: string
  refresh?: string
  expires?: number
}

/**
 * Client interface for auth operations
 */
interface AuthClient {
  set(providerId: string, auth: Auth): Promise<void>
}

/**
 * Debug logging helper
 * Only logs when ANTIGRAVITY_DEBUG=1
 */
function debugLog(message: string): void {
  if (process.env.ANTIGRAVITY_DEBUG === "1") {
    console.log(`[antigravity-fetch] ${message}`)
  }
}

/**
 * Check if an error is a retryable network/server error
 */
function isRetryableError(status: number): boolean {
  // 4xx client errors (except 429 rate limit) are not retryable
  // 5xx server errors are retryable
  // Network errors (status 0) are retryable
  if (status === 0) return true // Network error
  if (status === 429) return true // Rate limit
  if (status >= 500 && status < 600) return true // Server errors
  return false
}

/**
 * Attempt fetch with a single endpoint
 */
async function attemptFetch(
  endpoint: string,
  url: string,
  init: RequestInit,
  accessToken: string,
  projectId: string,
  modelName?: string
): Promise<Response | null> {
  debugLog(`Trying endpoint: ${endpoint}`)

  try {
    // Parse request body if present
    let body: Record<string, unknown> = {}
    if (init.body) {
      try {
        body =
          typeof init.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : (init.body as unknown as Record<string, unknown>)
      } catch {
        // If body parsing fails, use empty object
        body = {}
      }
    }

    // Apply tool normalization if tools present
    if (body.tools && Array.isArray(body.tools)) {
      const normalizedTools = normalizeToolsForGemini(body.tools as OpenAITool[])
      if (normalizedTools) {
        body.tools = normalizedTools
      }
    }

    // Transform request
    const transformed = transformRequest(
      url,
      body,
      accessToken,
      projectId,
      modelName,
      endpoint
    )

    // Make the request
    const response = await fetch(transformed.url, {
      method: init.method || "POST",
      headers: transformed.headers,
      body: JSON.stringify(transformed.body),
      signal: init.signal,
    })

    // Check for retryable errors
    if (!response.ok && isRetryableError(response.status)) {
      debugLog(`Endpoint failed: ${endpoint} (status: ${response.status}), trying next`)
      return null
    }

    return response
  } catch (error) {
    // Network error - try next endpoint
    debugLog(
      `Endpoint failed: ${endpoint} (${error instanceof Error ? error.message : "Unknown error"}), trying next`
    )
    return null
  }
}

/**
 * Transform response with thinking extraction if applicable
 */
async function transformResponseWithThinking(
  response: Response,
  modelName: string
): Promise<Response> {
  const streaming = isStreamingResponse(response)

  // Transform response based on streaming mode
  let result
  if (streaming) {
    result = await transformStreamingResponse(response)
  } else {
    result = await transformResponse(response)
  }

  // Apply thinking extraction for high-thinking models
  if (!streaming && shouldIncludeThinking(modelName)) {
    try {
      const text = await result.response.clone().text()
      const parsed = JSON.parse(text) as Record<string, unknown>

      // Extract and transform thinking blocks
      const thinkingResult = extractThinkingBlocks(parsed)
      if (thinkingResult.hasThinking) {
        const transformed = transformResponseThinking(parsed)
        return new Response(JSON.stringify(transformed), {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: result.response.headers,
        })
      }
    } catch {
      // If thinking extraction fails, return original transformed response
    }
  }

  return result.response
}

/**
 * Create Antigravity fetch interceptor
 *
 * Factory function that creates a custom fetch function for Antigravity API.
 * Handles token management, request/response transformation, and endpoint fallback.
 *
 * @param getAuth - Async function to retrieve current auth state
 * @param client - Auth client for saving updated tokens
 * @param providerId - Provider identifier (e.g., "google")
 * @returns Custom fetch function compatible with standard fetch signature
 *
 * @example
 * ```typescript
 * const customFetch = createAntigravityFetch(
 *   () => auth(),
 *   client,
 *   "google"
 * )
 *
 * // Use like standard fetch
 * const response = await customFetch("https://api.example.com/chat", {
 *   method: "POST",
 *   body: JSON.stringify({ messages: [...] })
 * })
 * ```
 */
export function createAntigravityFetch(
  getAuth: () => Promise<Auth>,
  client: AuthClient,
  providerId: string
): (url: string, init?: RequestInit) => Promise<Response> {
  // Cache for current token state
  let cachedTokens: AntigravityTokens | null = null
  let cachedProjectId: string | null = null

  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    debugLog(`Intercepting request to: ${url}`)

    // Get current auth state
    const auth = await getAuth()
    if (!auth.access || !auth.refresh) {
      throw new Error("Antigravity: No authentication tokens available")
    }

    // Parse stored token format
    const refreshParts = parseStoredToken(auth.refresh)

    // Build initial token state
    if (!cachedTokens) {
      cachedTokens = {
        type: "antigravity",
        access_token: auth.access,
        refresh_token: refreshParts.refreshToken,
        expires_in: auth.expires ? Math.floor((auth.expires - Date.now()) / 1000) : 3600,
        timestamp: auth.expires ? auth.expires - 3600 * 1000 : Date.now(),
      }
    } else {
      // Update with fresh values
      cachedTokens.access_token = auth.access
      cachedTokens.refresh_token = refreshParts.refreshToken
    }

    // Check token expiration and refresh if needed
    if (isTokenExpired(cachedTokens)) {
      debugLog("Token expired, refreshing...")

      try {
        const newTokens = await refreshAccessToken(refreshParts.refreshToken)

        // Update cached tokens
        cachedTokens = {
          type: "antigravity",
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token,
          expires_in: newTokens.expires_in,
          timestamp: Date.now(),
        }

        // Clear project context cache on token refresh
        clearProjectContextCache()

        // Format and save new tokens
        const formattedRefresh = formatTokenForStorage(
          newTokens.refresh_token,
          refreshParts.projectId || "",
          refreshParts.managedProjectId
        )

        await client.set(providerId, {
          access: newTokens.access_token,
          refresh: formattedRefresh,
          expires: Date.now() + newTokens.expires_in * 1000,
        })

        debugLog("Token refreshed successfully")
      } catch (error) {
        throw new Error(
          `Antigravity: Token refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`
        )
      }
    }

    // Get project context
    if (!cachedProjectId) {
      const projectContext = await fetchProjectContext(cachedTokens.access_token)
      cachedProjectId = projectContext.cloudaicompanionProject || ""
    }

    // Use project ID from refresh token if available, otherwise use fetched context
    const projectId = refreshParts.projectId || cachedProjectId

    // Extract model name from request body
    let modelName: string | undefined
    if (init.body) {
      try {
        const body =
          typeof init.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : (init.body as unknown as Record<string, unknown>)
        if (typeof body.model === "string") {
          modelName = body.model
        }
      } catch {
        // Ignore parsing errors
      }
    }

    // Try each endpoint in fallback order
    const maxEndpoints = Math.min(ANTIGRAVITY_ENDPOINT_FALLBACKS.length, 3)

    for (let i = 0; i < maxEndpoints; i++) {
      const endpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[i]

      const response = await attemptFetch(
        endpoint,
        url,
        init,
        cachedTokens.access_token,
        projectId,
        modelName
      )

      if (response) {
        debugLog(`Success with endpoint: ${endpoint}`)

        // Transform response (with thinking extraction if applicable)
        return transformResponseWithThinking(response, modelName || "")
      }
    }

    // All endpoints failed
    const errorMessage = `All Antigravity endpoints failed after ${maxEndpoints} attempts`
    debugLog(errorMessage)

    // Return error response
    return new Response(
      JSON.stringify({
        error: {
          message: errorMessage,
          type: "endpoint_failure",
          code: "all_endpoints_failed",
        },
      }),
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}

/**
 * Type export for createAntigravityFetch return type
 */
export type AntigravityFetch = (url: string, init?: RequestInit) => Promise<Response>
