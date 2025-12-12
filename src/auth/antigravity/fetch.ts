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
 * **Body Type Assumption:**
 * This interceptor assumes `init.body` is a JSON string (OpenAI format).
 * Non-string bodies (ReadableStream, Blob, FormData, URLSearchParams, etc.)
 * are passed through unchanged to the original fetch to avoid breaking
 * other requests that may not be OpenAI-format API calls.
 *
 * Debug logging available via ANTIGRAVITY_DEBUG=1 environment variable.
 */

import { ANTIGRAVITY_ENDPOINT_FALLBACKS, ANTIGRAVITY_DEFAULT_PROJECT_ID } from "./constants"
import { fetchProjectContext, clearProjectContextCache } from "./project"
import { isTokenExpired, refreshAccessToken, parseStoredToken, formatTokenForStorage } from "./token"
import { transformRequest } from "./request"
import { convertRequestBody, hasOpenAIMessages } from "./message-converter"
import {
  transformResponse,
  transformStreamingResponse,
  isStreamingResponse,
  extractSignatureFromSsePayload,
} from "./response"
import { normalizeToolsForGemini, type OpenAITool } from "./tools"
import { extractThinkingBlocks, shouldIncludeThinking, transformResponseThinking } from "./thinking"
import {
  getThoughtSignature,
  setThoughtSignature,
  getOrCreateSessionId,
} from "./thought-signature-store"
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

interface AttemptFetchOptions {
  endpoint: string
  url: string
  init: RequestInit
  accessToken: string
  projectId: string
  sessionId: string
  modelName?: string
  thoughtSignature?: string
}

async function attemptFetch(
  options: AttemptFetchOptions
): Promise<Response | null | "pass-through"> {
  const { endpoint, url, init, accessToken, projectId, sessionId, modelName, thoughtSignature } =
    options
  debugLog(`Trying endpoint: ${endpoint}`)

  try {
    const rawBody = init.body

    if (rawBody !== undefined && typeof rawBody !== "string") {
      debugLog(`Non-string body detected (${typeof rawBody}), signaling pass-through`)
      return "pass-through"
    }

    let parsedBody: Record<string, unknown> = {}
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody) as Record<string, unknown>
      } catch {
        parsedBody = {}
      }
    }

    debugLog(`[BODY] Keys: ${Object.keys(parsedBody).join(", ")}`)
    debugLog(`[BODY] Has contents: ${!!parsedBody.contents}, Has messages: ${!!parsedBody.messages}`)
    if (parsedBody.contents) {
      const contents = parsedBody.contents as Array<Record<string, unknown>>
      debugLog(`[BODY] contents length: ${contents.length}`)
      contents.forEach((c, i) => {
        debugLog(`[BODY] contents[${i}].role: ${c.role}, parts: ${JSON.stringify(c.parts).substring(0, 200)}`)
      })
    }

    if (parsedBody.tools && Array.isArray(parsedBody.tools)) {
      const normalizedTools = normalizeToolsForGemini(parsedBody.tools as OpenAITool[])
      if (normalizedTools) {
        parsedBody.tools = normalizedTools
      }
    }

    if (hasOpenAIMessages(parsedBody)) {
      debugLog(`[CONVERT] Converting OpenAI messages to Gemini contents`)
      parsedBody = convertRequestBody(parsedBody, thoughtSignature)
      debugLog(`[CONVERT] After conversion - Has contents: ${!!parsedBody.contents}`)
    }

    const transformed = transformRequest({
      url,
      body: parsedBody,
      accessToken,
      projectId,
      sessionId,
      modelName,
      endpointOverride: endpoint,
      thoughtSignature,
    })

    const response = await fetch(transformed.url, {
      method: init.method || "POST",
      headers: transformed.headers,
      body: JSON.stringify(transformed.body),
      signal: init.signal,
    })

    if (!response.ok && isRetryableError(response.status)) {
      debugLog(`Endpoint failed: ${endpoint} (status: ${response.status}), trying next`)
      return null
    }

    return response
  } catch (error) {
    debugLog(
      `Endpoint failed: ${endpoint} (${error instanceof Error ? error.message : "Unknown error"}), trying next`
    )
    return null
  }
}

interface GeminiResponsePart {
  thoughtSignature?: string
  thought_signature?: string
  functionCall?: Record<string, unknown>
  text?: string
  [key: string]: unknown
}

interface GeminiResponseCandidate {
  content?: {
    parts?: GeminiResponsePart[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface GeminiResponseBody {
  candidates?: GeminiResponseCandidate[]
  [key: string]: unknown
}

function extractSignatureFromResponse(parsed: GeminiResponseBody): string | undefined {
  if (!parsed.candidates || !Array.isArray(parsed.candidates)) {
    return undefined
  }

  for (const candidate of parsed.candidates) {
    const parts = candidate.content?.parts
    if (!parts || !Array.isArray(parts)) {
      continue
    }

    for (const part of parts) {
      const sig = part.thoughtSignature || part.thought_signature
      if (sig && typeof sig === "string") {
        return sig
      }
    }
  }

  return undefined
}

async function transformResponseWithThinking(
  response: Response,
  modelName: string,
  fetchInstanceId: string
): Promise<Response> {
  const streaming = isStreamingResponse(response)

  let result
  if (streaming) {
    result = await transformStreamingResponse(response)
  } else {
    result = await transformResponse(response)
  }

  try {
    const text = await result.response.clone().text()
    debugLog(`[TSIG][RESP] Response text length: ${text.length}`)

    if (streaming) {
      const signature = extractSignatureFromSsePayload(text)
      debugLog(`[TSIG][RESP] SSE signature extracted: ${signature ? "yes" : "no"}`)
      if (signature) {
        setThoughtSignature(fetchInstanceId, signature)
        debugLog(`[TSIG][STORE] Stored signature for ${fetchInstanceId}: ${signature.substring(0, 30)}...`)
      }
    } else {
      const parsed = JSON.parse(text) as GeminiResponseBody
      debugLog(`[TSIG][RESP] Parsed keys: ${Object.keys(parsed).join(", ")}`)
      debugLog(`[TSIG][RESP] Has candidates: ${!!parsed.candidates}, count: ${parsed.candidates?.length ?? 0}`)

      const signature = extractSignatureFromResponse(parsed)
      debugLog(`[TSIG][RESP] Signature extracted: ${signature ? signature.substring(0, 30) + "..." : "NONE"}`)
      if (signature) {
        setThoughtSignature(fetchInstanceId, signature)
        debugLog(`[TSIG][STORE] Stored signature for ${fetchInstanceId}`)
      } else {
        debugLog(`[TSIG][WARN] No signature found in response!`)
      }

      if (shouldIncludeThinking(modelName)) {
        const thinkingResult = extractThinkingBlocks(parsed)
        if (thinkingResult.hasThinking) {
          const transformed = transformResponseThinking(parsed)
          return new Response(JSON.stringify(transformed), {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          })
        }
      }
    }
  } catch {}

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
 * @param clientId - Optional custom client ID for token refresh (defaults to ANTIGRAVITY_CLIENT_ID)
 * @param clientSecret - Optional custom client secret for token refresh (defaults to ANTIGRAVITY_CLIENT_SECRET)
 * @returns Custom fetch function compatible with standard fetch signature
 *
 * @example
 * ```typescript
 * const customFetch = createAntigravityFetch(
 *   () => auth(),
 *   client,
 *   "google",
 *   "custom-client-id",
 *   "custom-client-secret"
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
  providerId: string,
  clientId?: string,
  clientSecret?: string
): (url: string, init?: RequestInit) => Promise<Response> {
  let cachedTokens: AntigravityTokens | null = null
  let cachedProjectId: string | null = null
  const fetchInstanceId = crypto.randomUUID()

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
        const newTokens = await refreshAccessToken(refreshParts.refreshToken, clientId, clientSecret)

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

    // Fetch project ID via loadCodeAssist (CLIProxyAPI approach)
    if (!cachedProjectId) {
      const projectContext = await fetchProjectContext(cachedTokens.access_token)
      cachedProjectId = projectContext.cloudaicompanionProject || ""
      debugLog(`[PROJECT] Fetched project ID: "${cachedProjectId}"`)
    }

    const projectId = cachedProjectId
    debugLog(`[PROJECT] Using project ID: "${projectId}"`)

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

    const maxEndpoints = Math.min(ANTIGRAVITY_ENDPOINT_FALLBACKS.length, 3)
    const sessionId = getOrCreateSessionId(fetchInstanceId)
    const thoughtSignature = getThoughtSignature(fetchInstanceId)
    debugLog(`[TSIG][GET] sessionId=${sessionId}, signature=${thoughtSignature ? thoughtSignature.substring(0, 20) + "..." : "none"}`)

    for (let i = 0; i < maxEndpoints; i++) {
      const endpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[i]

      const response = await attemptFetch({
        endpoint,
        url,
        init,
        accessToken: cachedTokens.access_token,
        projectId,
        sessionId,
        modelName,
        thoughtSignature,
      })

      if (response === "pass-through") {
        debugLog("Non-string body detected, passing through with auth headers")
        const headersWithAuth = {
          ...init.headers,
          Authorization: `Bearer ${cachedTokens.access_token}`,
        }
        return fetch(url, { ...init, headers: headersWithAuth })
      }

      if (response) {
        debugLog(`Success with endpoint: ${endpoint}`)
        const transformedResponse = await transformResponseWithThinking(
          response,
          modelName || "",
          fetchInstanceId
        )
        return transformedResponse
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
