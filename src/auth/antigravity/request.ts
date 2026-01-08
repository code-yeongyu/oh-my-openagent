/**
 * Antigravity request transformer.
 * Transforms OpenAI-format requests to Antigravity format.
 * Does NOT handle tool normalization (handled by tools.ts in Task 9).
 */

import {
    ANTIGRAVITY_API_VERSION,
    ANTIGRAVITY_ENDPOINT_FALLBACKS,
    ANTIGRAVITY_HEADERS,
    ANTIGRAVITY_SYSTEM_PROMPT,
    SKIP_THOUGHT_SIGNATURE_VALIDATOR,
    alias2ModelName,
} from "./constants"
import type { AntigravityRequestBody } from "./types"

/**
 * Result of request transformation including URL, headers, and body.
 */
export interface TransformedRequest {
  /** Transformed URL for Antigravity API */
  url: string
  /** Request headers including Authorization and Antigravity-specific headers */
  headers: Record<string, string>
  /** Transformed request body in Antigravity format */
  body: AntigravityRequestBody
  /** Whether this is a streaming request */
  streaming: boolean
}

/**
 * Build Antigravity-specific request headers.
 * Includes Authorization, User-Agent, X-Goog-Api-Client, and Client-Metadata.
 *
 * @param accessToken - OAuth access token for Authorization header
 * @returns Headers object with all required Antigravity headers
 */
export function buildRequestHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_HEADERS["User-Agent"],
    "X-Goog-Api-Client": ANTIGRAVITY_HEADERS["X-Goog-Api-Client"],
    "Client-Metadata": ANTIGRAVITY_HEADERS["Client-Metadata"],
  }
}

/**
 * Extract model name from request body.
 * OpenAI-format requests include model in the body.
 *
 * @param body - Request body that may contain a model field
 * @returns Model name or undefined if not found
 */
export function extractModelFromBody(
  body: Record<string, unknown>
): string | undefined {
  const model = body.model
  if (typeof model === "string" && model.trim()) {
    return model.trim()
  }
  return undefined
}

/**
 * Extract model name from URL path.
 * Handles Google Generative Language API format: /models/{model}:{action}
 *
 * @param url - Request URL to parse
 * @returns Model name or undefined if not found
 */
export function extractModelFromUrl(url: string): string | undefined {
  // Match Google's API format: /models/gemini-3-pro:generateContent
  const match = url.match(/\/models\/([^:]+):/)
  if (match && match[1]) {
    return match[1]
  }
  return undefined
}

/**
 * Determine the action type from the URL path.
 * E.g., generateContent, streamGenerateContent
 *
 * @param url - Request URL to parse
 * @returns Action name or undefined if not found
 */
export function extractActionFromUrl(url: string): string | undefined {
  // Match Google's API format: /models/gemini-3-pro:generateContent
  const match = url.match(/\/models\/[^:]+:(\w+)/)
  if (match && match[1]) {
    return match[1]
  }
  return undefined
}

/**
 * Check if a URL is targeting Google's Generative Language API.
 *
 * @param url - URL to check
 * @returns true if this is a Google Generative Language API request
 */
export function isGenerativeLanguageRequest(url: string): boolean {
  return url.includes("generativelanguage.googleapis.com")
}

/**
 * Build Antigravity API URL for the given action.
 *
 * @param baseEndpoint - Base Antigravity endpoint URL (from fallbacks)
 * @param action - API action (e.g., generateContent, streamGenerateContent)
 * @param streaming - Whether to append SSE query parameter
 * @returns Formatted Antigravity API URL
 */
export function buildAntigravityUrl(
  baseEndpoint: string,
  action: string,
  streaming: boolean
): string {
  const query = streaming ? "?alt=sse" : ""
  return `${baseEndpoint}/${ANTIGRAVITY_API_VERSION}:${action}${query}`
}

/**
 * Get the first available Antigravity endpoint.
 * Can be used with fallback logic in fetch.ts.
 *
 * @returns Default (first) Antigravity endpoint
 */
export function getDefaultEndpoint(): string {
  return ANTIGRAVITY_ENDPOINT_FALLBACKS[0]
}

function generateRequestId(): string {
  return `agent-${crypto.randomUUID()}`
}

/**
 * Inject ANTIGRAVITY_SYSTEM_PROMPT into request.systemInstruction.
 * Prepends Antigravity prompt before any existing systemInstruction.
 * Prevents duplicate injection by checking for <identity> marker.
 *
 * CRITICAL: Modifies wrappedBody.request.systemInstruction (NOT outer body!)
 *
 * @param wrappedBody - The wrapped request body with request field
 */
export function injectSystemPrompt(wrappedBody: { request?: unknown }): void {
  if (!wrappedBody.request || typeof wrappedBody.request !== "object") {
    return
  }

  const req = wrappedBody.request as Record<string, unknown>

  // Check for duplicate injection - if <identity> marker exists in first part, skip
  if (req.systemInstruction && typeof req.systemInstruction === "object") {
    const existing = req.systemInstruction as Record<string, unknown>
    if (existing.parts && Array.isArray(existing.parts)) {
      const firstPart = existing.parts[0]
      if (firstPart && typeof firstPart === "object" && "text" in firstPart) {
        const text = (firstPart as { text: string }).text
        if (text.includes("<identity>")) {
          return // Already injected, skip
        }
      }
    }
  }

  // Build new parts array - Antigravity prompt first, then existing parts
  const newParts: Array<{ text: string }> = [{ text: ANTIGRAVITY_SYSTEM_PROMPT }]

  // Prepend existing parts if systemInstruction exists with parts
  if (req.systemInstruction && typeof req.systemInstruction === "object") {
    const existing = req.systemInstruction as Record<string, unknown>
    if (existing.parts && Array.isArray(existing.parts)) {
      for (const part of existing.parts) {
        if (part && typeof part === "object" && "text" in part) {
          newParts.push(part as { text: string })
        }
      }
    }
  }

  // Set the new systemInstruction
  req.systemInstruction = {
    role: "user",
    parts: newParts,
  }
}

export function wrapRequestBody(
  body: Record<string, unknown>,
  projectId: string,
  modelName: string,
  sessionId: string
): AntigravityRequestBody {
  const requestPayload = { ...body }
  delete requestPayload.model

  let normalizedModel = modelName
  if (normalizedModel.startsWith("antigravity-")) {
    normalizedModel = normalizedModel.substring("antigravity-".length)
  }
  const apiModel = alias2ModelName(normalizedModel)
  debugLog(`[MODEL] input="${modelName}" → normalized="${normalizedModel}" → api="${apiModel}"`)

  const requestObj = {
    ...requestPayload,
    sessionId,
    toolConfig: {
      ...(requestPayload.toolConfig as Record<string, unknown> || {}),
      functionCallingConfig: {
        mode: "VALIDATED",
      },
    },
  }
  delete (requestObj as Record<string, unknown>).safetySettings

  const wrappedBody: AntigravityRequestBody = {
    project: projectId,
    model: apiModel,
    userAgent: "antigravity",
    requestType: "agent",
    requestId: generateRequestId(),
    request: requestObj,
  }

  injectSystemPrompt(wrappedBody)

  return wrappedBody
}

interface ContentPart {
  functionCall?: Record<string, unknown>
  thoughtSignature?: string
  [key: string]: unknown
}

interface ContentBlock {
  role?: string
  parts?: ContentPart[]
  [key: string]: unknown
}

function debugLog(message: string): void {
  if (process.env.ANTIGRAVITY_DEBUG === "1") {
    console.log(`[antigravity-request] ${message}`)
  }
}

export function injectThoughtSignatureIntoFunctionCalls(
  body: Record<string, unknown>,
  signature: string | undefined
): Record<string, unknown> {
  // Always use skip validator as fallback (CLIProxyAPI approach)
  const effectiveSignature = signature || SKIP_THOUGHT_SIGNATURE_VALIDATOR
  debugLog(`[TSIG][INJECT] signature=${effectiveSignature.substring(0, 30)}... (${signature ? "provided" : "default"})`)
  debugLog(`[TSIG][INJECT] body keys: ${Object.keys(body).join(", ")}`)

  const contents = body.contents as ContentBlock[] | undefined
  if (!contents || !Array.isArray(contents)) {
    debugLog(`[TSIG][INJECT] No contents array! Has messages: ${!!body.messages}`)
    return body
  }

  debugLog(`[TSIG][INJECT] Found ${contents.length} content blocks`)
  let injectedCount = 0
  const modifiedContents = contents.map((content) => {
    if (!content.parts || !Array.isArray(content.parts)) {
      return content
    }

    const modifiedParts = content.parts.map((part) => {
      if (part.functionCall && !part.thoughtSignature) {
        injectedCount++
        return {
          ...part,
          thoughtSignature: effectiveSignature,
        }
      }
      return part
    })

    return { ...content, parts: modifiedParts }
  })

  debugLog(`[TSIG][INJECT] injected signature into ${injectedCount} functionCall(s)`)
  return { ...body, contents: modifiedContents }
}

/**
 * Detect if request is for streaming.
 * Checks both action name and request body for stream flag.
 *
 * @param url - Request URL
 * @param body - Request body
 * @returns true if streaming is requested
 */
export function isStreamingRequest(
  url: string,
  body: Record<string, unknown>
): boolean {
  // Check URL action
  const action = extractActionFromUrl(url)
  if (action === "streamGenerateContent") {
    return true
  }

  // Check body for stream flag
  if (body.stream === true) {
    return true
  }

  return false
}

export interface TransformRequestOptions {
  url: string
  body: Record<string, unknown>
  accessToken: string
  projectId: string
  sessionId: string
  modelName?: string
  endpointOverride?: string
  thoughtSignature?: string
}

export function transformRequest(options: TransformRequestOptions): TransformedRequest {
  const {
    url,
    body,
    accessToken,
    projectId,
    sessionId,
    modelName,
    endpointOverride,
    thoughtSignature,
  } = options

  const effectiveModel =
    modelName || extractModelFromBody(body) || extractModelFromUrl(url) || "gemini-3-pro-high"

  const streaming = isStreamingRequest(url, body)
  const action = streaming ? "streamGenerateContent" : "generateContent"

  const endpoint = endpointOverride || getDefaultEndpoint()
  const transformedUrl = buildAntigravityUrl(endpoint, action, streaming)

  const headers = buildRequestHeaders(accessToken)
  if (streaming) {
    headers["Accept"] = "text/event-stream"
  }

  const bodyWithSignature = injectThoughtSignatureIntoFunctionCalls(body, thoughtSignature)
  const wrappedBody = wrapRequestBody(bodyWithSignature, projectId, effectiveModel, sessionId)

  return {
    url: transformedUrl,
    headers,
    body: wrappedBody,
    streaming,
  }
}

/**
 * Prepare request headers for streaming responses.
 * Adds Accept header for SSE format.
 *
 * @param headers - Existing headers object
 * @returns Headers with streaming support
 */
export function addStreamingHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return {
    ...headers,
    Accept: "text/event-stream",
  }
}
