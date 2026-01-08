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

import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from "./constants"
import { fetchProjectContext, clearProjectContextCache, invalidateProjectContextByRefreshToken } from "./project"
import { isTokenExpired, refreshAccessToken, parseStoredToken, formatTokenForStorage, AntigravityTokenRefreshError } from "./token"
import { AccountManager, type ManagedAccount } from "./accounts"
import { loadAccounts } from "./storage"
import type { ModelFamily } from "./types"
import { transformRequest } from "./request"
import { convertRequestBody, hasOpenAIMessages } from "./message-converter"
import {
  transformResponse,
  transformStreamingResponse,
  isStreamingResponse,
} from "./response"
import { normalizeToolsForGemini, type OpenAITool } from "./tools"
import { extractThinkingBlocks, shouldIncludeThinking, transformResponseThinking, extractThinkingConfig, applyThinkingConfigToRequest } from "./thinking"
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

function isRetryableError(status: number): boolean {
  if (status === 0) return true
  if (status === 429) return true
  if (status >= 500 && status < 600) return true
  return false
}

function getModelFamilyFromModelName(modelName: string): ModelFamily | null {
  const lower = modelName.toLowerCase()
  if (lower.includes("claude") || lower.includes("anthropic")) return "claude"
  if (lower.includes("flash")) return "gemini-flash"
  if (lower.includes("gemini")) return "gemini-pro"
  return null
}

function getModelFamilyFromUrl(url: string): ModelFamily {
  if (url.includes("claude")) return "claude"
  if (url.includes("flash")) return "gemini-flash"
  return "gemini-pro"
}

function getModelFamily(url: string, init?: RequestInit): ModelFamily {
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>
      if (typeof body.model === "string") {
        const fromModel = getModelFamilyFromModelName(body.model)
        if (fromModel) return fromModel
      }
    } catch {}
  }
  return getModelFamilyFromUrl(url)
}

const GCP_PERMISSION_ERROR_PATTERNS = [
  "PERMISSION_DENIED",
  "does not have permission",
  "Cloud AI Companion API has not been used",
  "has not been enabled",
] as const

function isGcpPermissionError(text: string): boolean {
  return GCP_PERMISSION_ERROR_PATTERNS.some((pattern) => text.includes(pattern))
}

function calculateRetryDelay(attempt: number): number {
  return Math.min(200 * Math.pow(2, attempt), 2000)
}

async function isRetryableResponse(response: Response): Promise<boolean> {
  if (isRetryableError(response.status)) return true
  if (response.status === 403) {
    try {
      const text = await response.clone().text()
      if (text.includes("SUBSCRIPTION_REQUIRED") || text.includes("Gemini Code Assist license")) {
        debugLog(`[RETRY] 403 SUBSCRIPTION_REQUIRED detected, will retry with next endpoint`)
        return true
      }
    } catch {}
  }
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

interface RateLimitInfo {
  type: "rate-limited"
  retryAfterMs: number
  status: number
}

type AttemptFetchResult = Response | null | "pass-through" | "needs-refresh" | RateLimitInfo

async function attemptFetch(
  options: AttemptFetchOptions
): Promise<AttemptFetchResult> {
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

    // Apply thinking config from reasoning_effort (from think-mode hook)
    const effectiveModel = modelName || transformed.body.model
    const thinkingConfig = extractThinkingConfig(
      parsedBody,
      parsedBody.generationConfig as Record<string, unknown> | undefined,
      parsedBody,
    )
    if (thinkingConfig) {
      debugLog(`[THINKING] Applying thinking config for model: ${effectiveModel}`)
      applyThinkingConfigToRequest(
        transformed.body as unknown as Record<string, unknown>,
        effectiveModel,
        thinkingConfig,
      )
      debugLog(`[THINKING] Thinking config applied successfully`)
    }

    debugLog(`[REQ] streaming=${transformed.streaming}, url=${transformed.url}`)

    const maxPermissionRetries = 10
    for (let attempt = 0; attempt <= maxPermissionRetries; attempt++) {
      const response = await fetch(transformed.url, {
        method: init.method || "POST",
        headers: transformed.headers,
        body: JSON.stringify(transformed.body),
        signal: init.signal,
      })

      debugLog(
        `[RESP] status=${response.status} content-type=${response.headers.get("content-type") ?? ""} url=${response.url}`
      )

      if (response.status === 401) {
        debugLog(`[401] Unauthorized response detected, signaling token refresh needed`)
        return "needs-refresh"
      }

      if (response.status === 403) {
        try {
          const text = await response.clone().text()
          if (isGcpPermissionError(text)) {
            if (attempt < maxPermissionRetries) {
              const delay = calculateRetryDelay(attempt)
              debugLog(`[RETRY] GCP permission error, retry ${attempt + 1}/${maxPermissionRetries} after ${delay}ms`)
              await new Promise((resolve) => setTimeout(resolve, delay))
              continue
            }
            debugLog(`[RETRY] GCP permission error, max retries exceeded`)
          }
        } catch {}
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after")
        let retryAfterMs = 60000
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10)
          if (!isNaN(parsed) && parsed > 0) {
            retryAfterMs = parsed * 1000
          } else {
            const httpDate = Date.parse(retryAfter)
            if (!isNaN(httpDate)) {
              retryAfterMs = Math.max(0, httpDate - Date.now())
            }
          }
        }
        debugLog(`[429] Rate limited, retry-after: ${retryAfterMs}ms`)
        await response.body?.cancel()
        return { type: "rate-limited" as const, retryAfterMs, status: 429 }
      }

      if (response.status >= 500 && response.status < 600) {
        debugLog(`[5xx] Server error ${response.status}, marking for rotation`)
        await response.body?.cancel()
        return { type: "rate-limited" as const, retryAfterMs: 300000, status: response.status }
      }

      if (!response.ok && (await isRetryableResponse(response))) {
        debugLog(`Endpoint failed: ${endpoint} (status: ${response.status}), trying next`)
        return null
      }

      return response
    }

    return null
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

  if (streaming) {
    return result.response
  }

  try {
    const text = await result.response.clone().text()
    debugLog(`[TSIG][RESP] Response text length: ${text.length}`)

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
  clientSecret?: string,
  accountManager?: AccountManager | null
): (url: string, init?: RequestInit) => Promise<Response> {
  let cachedTokens: AntigravityTokens | null = null
  let cachedProjectId: string | null = null
  let lastAccountIndex: number | null = null
  const fetchInstanceId = crypto.randomUUID()
  let manager: AccountManager | null = accountManager || null
  let accountsLoaded = false

  const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
    debugLog(`Intercepting request to: ${url}`)

    // Get current auth state
    const auth = await getAuth()
    if (!auth.access || !auth.refresh) {
      throw new Error("Antigravity: No authentication tokens available")
    }

    // Parse stored token format
    let refreshParts = parseStoredToken(auth.refresh)

    if (!accountsLoaded && !manager && auth.refresh) {
      try {
        const storedAccounts = await loadAccounts()
        if (storedAccounts) {
          manager = new AccountManager(
            { refresh: auth.refresh, access: auth.access || "", expires: auth.expires || 0 },
            storedAccounts
          )
          debugLog(`[ACCOUNTS] Loaded ${manager.getAccountCount()} accounts from storage`)
        }
      } catch (error) {
        debugLog(`[ACCOUNTS] Failed to load accounts, falling back to single-account: ${error instanceof Error ? error.message : "Unknown"}`)
      }
      accountsLoaded = true
    }

    let currentAccount: ManagedAccount | null = null
    if (manager) {
      const family = getModelFamily(url, init)
      currentAccount = manager.getCurrentOrNextForFamily(family)

      if (currentAccount) {
        debugLog(`[ACCOUNTS] Using account ${currentAccount.index + 1}/${manager.getAccountCount()} for ${family}`)

        if (lastAccountIndex === null || lastAccountIndex !== currentAccount.index) {
          if (lastAccountIndex !== null) {
            debugLog(`[ACCOUNTS] Account changed from ${lastAccountIndex + 1} to ${currentAccount.index + 1}, clearing cached state`)
          } else if (cachedProjectId) {
            debugLog(`[ACCOUNTS] First account introduced, clearing cached state`)
          }
          cachedProjectId = null
          cachedTokens = null
        }
        lastAccountIndex = currentAccount.index

        if (currentAccount.access && currentAccount.expires) {
          auth.access = currentAccount.access
          auth.expires = currentAccount.expires
        }

        refreshParts = {
          refreshToken: currentAccount.parts.refreshToken,
          projectId: currentAccount.parts.projectId,
          managedProjectId: currentAccount.parts.managedProjectId,
        }
      }
    }

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

        cachedTokens = {
          type: "antigravity",
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token,
          expires_in: newTokens.expires_in,
          timestamp: Date.now(),
        }

        clearProjectContextCache()

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
        if (error instanceof AntigravityTokenRefreshError) {
          if (error.isInvalidGrant) {
            debugLog(`[REFRESH] Token revoked (invalid_grant), clearing caches`)
            invalidateProjectContextByRefreshToken(refreshParts.refreshToken)
            clearProjectContextCache()
          }
          throw new Error(
            `Antigravity: Token refresh failed: ${error.description || error.message}${error.code ? ` (${error.code})` : ""}`
          )
        }
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

    let hasRefreshedFor401 = false

    const executeWithEndpoints = async (): Promise<Response> => {
      for (let i = 0; i < maxEndpoints; i++) {
        const endpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[i]

        const response = await attemptFetch({
          endpoint,
          url,
          init,
          accessToken: cachedTokens!.access_token,
          projectId,
          sessionId,
          modelName,
          thoughtSignature,
        })

        if (response === "pass-through") {
          debugLog("Non-string body detected, passing through with auth headers")
          const headersWithAuth = {
            ...init.headers,
            Authorization: `Bearer ${cachedTokens!.access_token}`,
          }
          return fetch(url, { ...init, headers: headersWithAuth })
        }

        if (response === "needs-refresh") {
          if (hasRefreshedFor401) {
            debugLog("[401] Already refreshed once, returning unauthorized error")
            return new Response(
              JSON.stringify({
                error: {
                  message: "Authentication failed after token refresh",
                  type: "unauthorized",
                  code: "token_refresh_failed",
                },
              }),
              {
                status: 401,
                statusText: "Unauthorized",
                headers: { "Content-Type": "application/json" },
              }
            )
          }

          debugLog("[401] Refreshing token and retrying...")
          hasRefreshedFor401 = true

          try {
            const newTokens = await refreshAccessToken(
              refreshParts.refreshToken,
              clientId,
              clientSecret
            )

            cachedTokens = {
              type: "antigravity",
              access_token: newTokens.access_token,
              refresh_token: newTokens.refresh_token,
              expires_in: newTokens.expires_in,
              timestamp: Date.now(),
            }

            clearProjectContextCache()

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

            debugLog("[401] Token refreshed, retrying request...")
            return executeWithEndpoints()
          } catch (refreshError) {
            if (refreshError instanceof AntigravityTokenRefreshError) {
              if (refreshError.isInvalidGrant) {
                debugLog(`[401] Token revoked (invalid_grant), clearing caches`)
                invalidateProjectContextByRefreshToken(refreshParts.refreshToken)
                clearProjectContextCache()
              }
              debugLog(`[401] Token refresh failed: ${refreshError.description || refreshError.message}`)
              return new Response(
                JSON.stringify({
                  error: {
                    message: refreshError.description || refreshError.message,
                    type: refreshError.isInvalidGrant ? "token_revoked" : "unauthorized",
                    code: refreshError.code || "token_refresh_failed",
                  },
                }),
                {
                  status: 401,
                  statusText: "Unauthorized",
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            debugLog(`[401] Token refresh failed: ${refreshError instanceof Error ? refreshError.message : "Unknown error"}`)
            return new Response(
              JSON.stringify({
                error: {
                  message: refreshError instanceof Error ? refreshError.message : "Unknown error",
                  type: "unauthorized",
                  code: "token_refresh_failed",
                },
              }),
              {
                status: 401,
                statusText: "Unauthorized",
                headers: { "Content-Type": "application/json" },
              }
            )
          }
        }

        if (response && typeof response === "object" && "type" in response && response.type === "rate-limited") {
          const rateLimitInfo = response as RateLimitInfo
          const family = getModelFamily(url, init)

          if (rateLimitInfo.retryAfterMs > 5000 && manager && currentAccount) {
            manager.markRateLimited(currentAccount, rateLimitInfo.retryAfterMs, family)
            await manager.save()
            debugLog(`[RATE-LIMIT] Account ${currentAccount.index + 1} rate-limited for ${family}, rotating...`)

            const nextAccount = manager.getCurrentOrNextForFamily(family)
            if (nextAccount && nextAccount.index !== currentAccount.index) {
              debugLog(`[RATE-LIMIT] Switched to account ${nextAccount.index + 1}`)
              return fetchFn(url, init)
            }
          }

          const isLastEndpoint = i === maxEndpoints - 1
          if (isLastEndpoint) {
            const isServerError = rateLimitInfo.status >= 500
            debugLog(`[RATE-LIMIT] No alternative account or endpoint, returning ${rateLimitInfo.status}`)
            return new Response(
              JSON.stringify({
                error: {
                  message: isServerError
                    ? `Server error (${rateLimitInfo.status}). Retry after ${Math.ceil(rateLimitInfo.retryAfterMs / 1000)} seconds`
                    : `Rate limited. Retry after ${Math.ceil(rateLimitInfo.retryAfterMs / 1000)} seconds`,
                  type: isServerError ? "server_error" : "rate_limit",
                  code: isServerError ? "server_error" : "rate_limited",
                },
              }),
              {
                status: rateLimitInfo.status,
                statusText: isServerError ? "Server Error" : "Too Many Requests",
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": String(Math.ceil(rateLimitInfo.retryAfterMs / 1000)),
                },
              }
            )
          }

          debugLog(`[RATE-LIMIT] No alternative account available, trying next endpoint`)
          continue
        }

        if (response && response instanceof Response) {
          debugLog(`Success with endpoint: ${endpoint}`)
          const transformedResponse = await transformResponseWithThinking(
            response,
            modelName || "",
            fetchInstanceId
          )
          return transformedResponse
        }
      }

      const errorMessage = `All Antigravity endpoints failed after ${maxEndpoints} attempts`
      debugLog(errorMessage)

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

    return executeWithEndpoints()
  }

  return fetchFn
}

/**
 * Type export for createAntigravityFetch return type
 */
export type AntigravityFetch = (url: string, init?: RequestInit) => Promise<Response>
