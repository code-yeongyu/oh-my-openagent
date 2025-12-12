/**
 * Antigravity project context management.
 * Handles fetching GCP project ID via Google's loadCodeAssist API.
 */

import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_HEADERS,
} from "./constants"
import type {
  AntigravityProjectContext,
  AntigravityLoadCodeAssistResponse,
} from "./types"

/**
 * In-memory cache for project context per access token.
 * Prevents redundant API calls for the same token.
 */
const projectContextCache = new Map<string, AntigravityProjectContext>()

/**
 * Client metadata for loadCodeAssist API request.
 * Matches cliproxyapi implementation.
 */
const CODE_ASSIST_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const

/**
 * Extracts the project ID from a cloudaicompanionProject field.
 * Handles both string and object formats.
 *
 * @param project - The cloudaicompanionProject value from API response
 * @returns Extracted project ID string, or undefined if not found
 */
function extractProjectId(
  project: string | { id: string } | undefined
): string | undefined {
  if (!project) {
    return undefined
  }

  // Handle string format
  if (typeof project === "string") {
    const trimmed = project.trim()
    return trimmed || undefined
  }

  // Handle object format { id: string }
  if (typeof project === "object" && "id" in project) {
    const id = project.id
    if (typeof id === "string") {
      const trimmed = id.trim()
      return trimmed || undefined
    }
  }

  return undefined
}

/**
 * Calls the loadCodeAssist API to get project context.
 * Tries each endpoint in the fallback list until one succeeds.
 *
 * @param accessToken - Valid OAuth access token
 * @returns API response or null if all endpoints fail
 */
async function callLoadCodeAssistAPI(
  accessToken: string
): Promise<AntigravityLoadCodeAssistResponse | null> {
  const requestBody = {
    metadata: CODE_ASSIST_METADATA,
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_HEADERS["User-Agent"],
    "X-Goog-Api-Client": ANTIGRAVITY_HEADERS["X-Goog-Api-Client"],
    "Client-Metadata": ANTIGRAVITY_HEADERS["Client-Metadata"],
  }

  // Try each endpoint in the fallback list
  for (const baseEndpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
    const url = `${baseEndpoint}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        // Try next endpoint on failure
        continue
      }

      const data =
        (await response.json()) as AntigravityLoadCodeAssistResponse
      return data
    } catch {
      // Network or parsing error, try next endpoint
      continue
    }
  }

  // All endpoints failed
  return null
}

/**
 * Fetch project context from Google's loadCodeAssist API.
 * Extracts the cloudaicompanionProject from the response.
 * Falls back to ANTIGRAVITY_DEFAULT_PROJECT_ID if API fails or returns empty.
 *
 * @param accessToken - Valid OAuth access token
 * @returns Project context with cloudaicompanionProject ID
 */
export async function fetchProjectContext(
  accessToken: string
): Promise<AntigravityProjectContext> {
  // Check cache first
  const cached = projectContextCache.get(accessToken)
  if (cached) {
    return cached
  }

  // Call the API
  const response = await callLoadCodeAssistAPI(accessToken)

  // Extract project ID from response
  const projectId = response
    ? extractProjectId(response.cloudaicompanionProject)
    : undefined

  // Build result with fallback
  const result: AntigravityProjectContext = {
    cloudaicompanionProject: projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
  }

  // Cache the result
  if (projectId) {
    projectContextCache.set(accessToken, result)
  }

  return result
}

/**
 * Clear the project context cache.
 * Call this when tokens are refreshed or invalidated.
 *
 * @param accessToken - Optional specific token to clear, or clears all if not provided
 */
export function clearProjectContextCache(accessToken?: string): void {
  if (accessToken) {
    projectContextCache.delete(accessToken)
  } else {
    projectContextCache.clear()
  }
}
