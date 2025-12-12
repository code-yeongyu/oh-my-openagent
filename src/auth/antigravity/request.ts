/**
 * Antigravity request transformer.
 * Transforms OpenAI-format requests to Antigravity format.
 * Does NOT handle tool normalization (handled by tools.ts in Task 9).
 */

import {
  ANTIGRAVITY_HEADERS,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_API_VERSION,
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

/**
 * Wrap a request body in Antigravity format.
 * Creates a new object without modifying the original.
 *
 * @param body - Original request payload
 * @param projectId - GCP project ID
 * @param modelName - Model identifier
 * @returns Wrapped request body in Antigravity format
 */
export function wrapRequestBody(
  body: Record<string, unknown>,
  projectId: string,
  modelName: string
): AntigravityRequestBody {
  // Clone the body to avoid mutation
  const requestPayload = { ...body }

  // Remove model from inner request (it's in wrapper)
  delete requestPayload.model

  return {
    project: projectId,
    model: modelName,
    request: requestPayload,
  }
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

/**
 * Transform an OpenAI-format request to Antigravity format.
 * This is the main transformation function used by the fetch interceptor.
 *
 * @param url - Original request URL
 * @param body - Original request body (OpenAI format)
 * @param accessToken - OAuth access token for Authorization
 * @param projectId - GCP project ID for wrapper
 * @param modelName - Model name to use (overrides body.model if provided)
 * @param endpointOverride - Optional endpoint override (uses first fallback if not provided)
 * @returns Transformed request with URL, headers, body, and streaming flag
 */
export function transformRequest(
  url: string,
  body: Record<string, unknown>,
  accessToken: string,
  projectId: string,
  modelName?: string,
  endpointOverride?: string
): TransformedRequest {
  // Determine model name (parameter override > body > URL)
  const effectiveModel =
    modelName || extractModelFromBody(body) || extractModelFromUrl(url) || "gemini-3-pro-preview"

  // Determine if streaming
  const streaming = isStreamingRequest(url, body)

  // Determine action (default to appropriate generate action)
  const action = streaming ? "streamGenerateContent" : "generateContent"

  // Build URL
  const endpoint = endpointOverride || getDefaultEndpoint()
  const transformedUrl = buildAntigravityUrl(endpoint, action, streaming)

  // Build headers
  const headers = buildRequestHeaders(accessToken)
  if (streaming) {
    headers["Accept"] = "text/event-stream"
  }

  // Wrap body in Antigravity format
  const wrappedBody = wrapRequestBody(body, projectId, effectiveModel)

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
