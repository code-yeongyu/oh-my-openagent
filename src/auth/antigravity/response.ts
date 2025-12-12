/**
 * Antigravity Response Handler
 * Transforms Antigravity/Gemini API responses to OpenAI-compatible format
 *
 * Key responsibilities:
 * - Non-streaming response transformation
 * - SSE streaming response transformation (buffered - see transformStreamingResponse)
 * - Error response handling with retry-after extraction
 * - Usage metadata extraction from x-antigravity-* headers
 */

import type { AntigravityError, AntigravityUsage } from "./types"

/**
 * Usage metadata extracted from Antigravity response headers
 */
export interface AntigravityUsageMetadata {
  cachedContentTokenCount?: number
  totalTokenCount?: number
  promptTokenCount?: number
  candidatesTokenCount?: number
}

/**
 * Transform result with response and metadata
 */
export interface TransformResult {
  response: Response
  usage?: AntigravityUsageMetadata
  retryAfterMs?: number
  error?: AntigravityError
}

/**
 * Extract usage metadata from Antigravity response headers
 *
 * Antigravity sets these headers:
 * - x-antigravity-cached-content-token-count
 * - x-antigravity-total-token-count
 * - x-antigravity-prompt-token-count
 * - x-antigravity-candidates-token-count
 *
 * @param headers - Response headers
 * @returns Usage metadata if found
 */
export function extractUsageFromHeaders(headers: Headers): AntigravityUsageMetadata | undefined {
  const cached = headers.get("x-antigravity-cached-content-token-count")
  const total = headers.get("x-antigravity-total-token-count")
  const prompt = headers.get("x-antigravity-prompt-token-count")
  const candidates = headers.get("x-antigravity-candidates-token-count")

  // Return undefined if no usage headers found
  if (!cached && !total && !prompt && !candidates) {
    return undefined
  }

  const usage: AntigravityUsageMetadata = {}

  if (cached) {
    const parsed = parseInt(cached, 10)
    if (!isNaN(parsed)) {
      usage.cachedContentTokenCount = parsed
    }
  }

  if (total) {
    const parsed = parseInt(total, 10)
    if (!isNaN(parsed)) {
      usage.totalTokenCount = parsed
    }
  }

  if (prompt) {
    const parsed = parseInt(prompt, 10)
    if (!isNaN(parsed)) {
      usage.promptTokenCount = parsed
    }
  }

  if (candidates) {
    const parsed = parseInt(candidates, 10)
    if (!isNaN(parsed)) {
      usage.candidatesTokenCount = parsed
    }
  }

  return Object.keys(usage).length > 0 ? usage : undefined
}

/**
 * Extract retry-after value from error response
 *
 * Antigravity returns retry info in error.details array:
 * {
 *   error: {
 *     details: [{
 *       "@type": "type.googleapis.com/google.rpc.RetryInfo",
 *       "retryDelay": "5.123s"
 *     }]
 *   }
 * }
 *
 * Also checks standard Retry-After header.
 *
 * @param response - Response object (for headers)
 * @param errorBody - Parsed error body (optional)
 * @returns Retry after value in milliseconds, or undefined
 */
export function extractRetryAfterMs(
  response: Response,
  errorBody?: Record<string, unknown>,
): number | undefined {
  // First, check standard Retry-After header
  const retryAfterHeader = response.headers.get("Retry-After")
  if (retryAfterHeader) {
    const seconds = parseFloat(retryAfterHeader)
    if (!isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000)
    }
  }

  // Check retry-after-ms header (set by some transformers)
  const retryAfterMsHeader = response.headers.get("retry-after-ms")
  if (retryAfterMsHeader) {
    const ms = parseInt(retryAfterMsHeader, 10)
    if (!isNaN(ms) && ms > 0) {
      return ms
    }
  }

  // Check error body for RetryInfo
  if (!errorBody) {
    return undefined
  }

  const error = errorBody.error as Record<string, unknown> | undefined
  if (!error?.details || !Array.isArray(error.details)) {
    return undefined
  }

  const retryInfo = (error.details as Array<Record<string, unknown>>).find(
    (detail) => detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
  )

  if (!retryInfo?.retryDelay || typeof retryInfo.retryDelay !== "string") {
    return undefined
  }

  // Parse retryDelay format: "5.123s"
  const match = retryInfo.retryDelay.match(/^([\d.]+)s$/)
  if (match?.[1]) {
    const seconds = parseFloat(match[1])
    if (!isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000)
    }
  }

  return undefined
}

/**
 * Parse error response body and extract useful details
 *
 * @param text - Raw response text
 * @returns Parsed error or undefined
 */
export function parseErrorBody(text: string): AntigravityError | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>

    // Handle error wrapper
    if (parsed.error && typeof parsed.error === "object") {
      const errorObj = parsed.error as Record<string, unknown>
      return {
        message: String(errorObj.message || "Unknown error"),
        type: errorObj.type ? String(errorObj.type) : undefined,
        code: errorObj.code as string | number | undefined,
      }
    }

    // Handle direct error message
    if (parsed.message && typeof parsed.message === "string") {
      return {
        message: parsed.message,
        type: parsed.type ? String(parsed.type) : undefined,
        code: parsed.code as string | number | undefined,
      }
    }

    return undefined
  } catch {
    // If not valid JSON, return generic error
    return {
      message: text || "Unknown error",
    }
  }
}

/**
 * Transform a non-streaming Antigravity response to OpenAI-compatible format
 *
 * For non-streaming responses:
 * - Parses the response body
 * - Unwraps the `response` field if present (Antigravity wraps responses)
 * - Extracts usage metadata from headers
 * - Handles error responses
 *
 * Note: Does NOT handle thinking block extraction (Task 10)
 * Note: Does NOT handle tool normalization (Task 9)
 *
 * @param response - Fetch Response object
 * @returns TransformResult with transformed response and metadata
 */
export async function transformResponse(response: Response): Promise<TransformResult> {
  const headers = new Headers(response.headers)
  const usage = extractUsageFromHeaders(headers)

  // Handle error responses
  if (!response.ok) {
    const text = await response.text()
    const error = parseErrorBody(text)
    const retryAfterMs = extractRetryAfterMs(response, error ? { error } : undefined)

    // Parse to get full error body for retry-after extraction
    let errorBody: Record<string, unknown> | undefined
    try {
      errorBody = JSON.parse(text) as Record<string, unknown>
    } catch {
      errorBody = { error: { message: text } }
    }

    const retryMs = extractRetryAfterMs(response, errorBody) ?? retryAfterMs

    // Set retry headers if found
    if (retryMs) {
      headers.set("Retry-After", String(Math.ceil(retryMs / 1000)))
      headers.set("retry-after-ms", String(retryMs))
    }

    return {
      response: new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      usage,
      retryAfterMs: retryMs,
      error,
    }
  }

  // Handle successful response
  const contentType = response.headers.get("content-type") ?? ""
  const isJson = contentType.includes("application/json")

  if (!isJson) {
    // Return non-JSON responses as-is
    return { response, usage }
  }

  try {
    const text = await response.text()
    const parsed = JSON.parse(text) as Record<string, unknown>

    // Antigravity wraps response in { response: { ... } }
    // Unwrap if present
    let transformedBody: unknown = parsed
    if (parsed.response !== undefined) {
      transformedBody = parsed.response
    }

    return {
      response: new Response(JSON.stringify(transformedBody), {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      usage,
    }
  } catch {
    // If parsing fails, return original response
    return { response, usage }
  }
}

/**
 * Transform a single SSE data line
 *
 * Antigravity SSE format:
 * data: { "response": { ... actual data ... } }
 *
 * OpenAI SSE format:
 * data: { ... actual data ... }
 *
 * @param line - SSE data line
 * @returns Transformed line
 */
function transformSseLine(line: string): string {
  if (!line.startsWith("data:")) {
    return line
  }

  const json = line.slice(5).trim()
  if (!json || json === "[DONE]") {
    return line
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>

    // Unwrap { response: { ... } } wrapper
    if (parsed.response !== undefined) {
      return `data: ${JSON.stringify(parsed.response)}`
    }

    return line
  } catch {
    // If parsing fails, return original line
    return line
  }
}

/**
 * Transform SSE streaming payload
 *
 * Processes each line in the SSE stream:
 * - Unwraps { response: { ... } } wrapper from data lines
 * - Preserves other SSE control lines (event:, id:, retry:, empty lines)
 *
 * Note: Does NOT extract thinking blocks (Task 10)
 *
 * @param payload - Raw SSE payload text
 * @returns Transformed SSE payload
 */
export function transformStreamingPayload(payload: string): string {
  return payload
    .split("\n")
    .map(transformSseLine)
    .join("\n")
}

/**
 * Transforms a streaming SSE response from Antigravity to OpenAI format.
 *
 * **⚠️ CURRENT IMPLEMENTATION: BUFFERING**
 * This implementation reads the entire stream into memory before transforming.
 * While functional, it does not preserve true streaming characteristics:
 * - Blocks until entire response is received
 * - Consumes memory proportional to response size
 * - Increases Time-To-First-Byte (TTFB)
 *
 * **TODO: Future Enhancement**
 * Implement true streaming using ReadableStream transformation:
 * - Parse SSE chunks incrementally
 * - Transform and yield chunks as they arrive
 * - Reduce memory footprint and TTFB
 *
 * For streaming responses (current buffered approach):
 * - Unwraps the `response` field from each SSE event
 * - Returns transformed SSE text as new Response
 * - Extracts usage metadata from headers
 *
 * Note: Does NOT handle thinking block extraction (Task 10)
 *
 * @param response - The SSE response from Antigravity API
 * @returns TransformResult with transformed response and metadata
 */
export async function transformStreamingResponse(response: Response): Promise<TransformResult> {
  const headers = new Headers(response.headers)
  const usage = extractUsageFromHeaders(headers)

  // Handle error responses
  if (!response.ok) {
    const text = await response.text()
    const error = parseErrorBody(text)

    let errorBody: Record<string, unknown> | undefined
    try {
      errorBody = JSON.parse(text) as Record<string, unknown>
    } catch {
      errorBody = { error: { message: text } }
    }

    const retryAfterMs = extractRetryAfterMs(response, errorBody)

    if (retryAfterMs) {
      headers.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
      headers.set("retry-after-ms", String(retryAfterMs))
    }

    return {
      response: new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      usage,
      retryAfterMs,
      error,
    }
  }

  // Check content type
  const contentType = response.headers.get("content-type") ?? ""
  const isEventStream = contentType.includes("text/event-stream")

  if (!isEventStream) {
    // Not SSE, delegate to non-streaming transform
    // Clone response since we need to read it
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      let transformedBody: unknown = parsed
      if (parsed.response !== undefined) {
        transformedBody = parsed.response
      }
      return {
        response: new Response(JSON.stringify(transformedBody), {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
        usage,
      }
    } catch {
      return {
        response: new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
        usage,
      }
    }
  }

  // Handle SSE stream
  // NOTE: Current implementation buffers entire stream - see JSDoc for details
  try {
    const text = await response.text()
    const transformed = transformStreamingPayload(text)

    return {
      response: new Response(transformed, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      usage,
    }
  } catch {
    // If reading fails, return original response
    return { response, usage }
  }
}

/**
 * Check if response is a streaming SSE response
 *
 * @param response - Fetch Response object
 * @returns True if response is SSE stream
 */
export function isStreamingResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? ""
  return contentType.includes("text/event-stream")
}

/**
 * Extract usage from SSE payload text
 *
 * Looks for usageMetadata in SSE events:
 * data: { "usageMetadata": { ... } }
 *
 * @param payload - SSE payload text
 * @returns Usage if found
 */
export function extractUsageFromSsePayload(payload: string): AntigravityUsage | undefined {
  const lines = payload.split("\n")

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue
    }

    const json = line.slice(5).trim()
    if (!json || json === "[DONE]") {
      continue
    }

    try {
      const parsed = JSON.parse(json) as Record<string, unknown>

      // Check for usageMetadata at top level
      if (parsed.usageMetadata && typeof parsed.usageMetadata === "object") {
        const meta = parsed.usageMetadata as Record<string, unknown>
        return {
          prompt_tokens: typeof meta.promptTokenCount === "number" ? meta.promptTokenCount : 0,
          completion_tokens:
            typeof meta.candidatesTokenCount === "number" ? meta.candidatesTokenCount : 0,
          total_tokens: typeof meta.totalTokenCount === "number" ? meta.totalTokenCount : 0,
        }
      }

      // Check for usage in response wrapper
      if (parsed.response && typeof parsed.response === "object") {
        const resp = parsed.response as Record<string, unknown>
        if (resp.usageMetadata && typeof resp.usageMetadata === "object") {
          const meta = resp.usageMetadata as Record<string, unknown>
          return {
            prompt_tokens: typeof meta.promptTokenCount === "number" ? meta.promptTokenCount : 0,
            completion_tokens:
              typeof meta.candidatesTokenCount === "number" ? meta.candidatesTokenCount : 0,
            total_tokens: typeof meta.totalTokenCount === "number" ? meta.totalTokenCount : 0,
          }
        }
      }

      // Check for standard OpenAI-style usage
      if (parsed.usage && typeof parsed.usage === "object") {
        const u = parsed.usage as Record<string, unknown>
        return {
          prompt_tokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
          completion_tokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
          total_tokens: typeof u.total_tokens === "number" ? u.total_tokens : 0,
        }
      }
    } catch {
      // Continue to next line if parsing fails
    }
  }

  return undefined
}
