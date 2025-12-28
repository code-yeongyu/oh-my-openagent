/**
 * Antigravity project context management.
 * Handles fetching GCP project ID via Google's loadCodeAssist API.
 * For FREE tier users, onboards via onboardUser API to get server-assigned managed project ID.
 * Reference: https://github.com/shekohex/opencode-google-antigravity-auth
 */

import {
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_HEADERS,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
} from "./constants"
import type {
  AntigravityProjectContext,
  AntigravityLoadCodeAssistResponse,
  AntigravityOnboardUserPayload,
  AntigravityUserTier,
} from "./types"

const projectContextCache = new Map<string, AntigravityProjectContext>()

function debugLog(message: string): void {
  if (process.env.ANTIGRAVITY_DEBUG === "1") {
    console.log(`[antigravity-project] ${message}`)
  }
}

const CODE_ASSIST_METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const

function extractProjectId(
  project: string | { id: string } | undefined
): string | undefined {
  if (!project) return undefined
  if (typeof project === "string") {
    const trimmed = project.trim()
    return trimmed || undefined
  }
  if (typeof project === "object" && "id" in project) {
    const id = project.id
    if (typeof id === "string") {
      const trimmed = id.trim()
      return trimmed || undefined
    }
  }
  return undefined
}

function getDefaultTierId(allowedTiers?: AntigravityUserTier[]): string | undefined {
  if (!allowedTiers || allowedTiers.length === 0) return undefined
  for (const tier of allowedTiers) {
    if (tier?.isDefault) return tier.id
  }
  return allowedTiers[0]?.id
}

function isFreeTier(tierId: string | undefined): boolean {
  if (!tierId) return true // No tier = assume free tier (default behavior)
  const lower = tierId.toLowerCase()
  return lower === "free" || lower === "free-tier" || lower.startsWith("free")
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callLoadCodeAssistAPI(
  accessToken: string,
  projectId?: string
): Promise<AntigravityLoadCodeAssistResponse | null> {
  const metadata: Record<string, string> = { ...CODE_ASSIST_METADATA }
  if (projectId) metadata.duetProject = projectId

  const requestBody: Record<string, unknown> = { metadata }
  if (projectId) requestBody.cloudaicompanionProject = projectId

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_HEADERS["User-Agent"],
    "X-Goog-Api-Client": ANTIGRAVITY_HEADERS["X-Goog-Api-Client"],
    "Client-Metadata": ANTIGRAVITY_HEADERS["Client-Metadata"],
  }

  for (const baseEndpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
    const url = `${baseEndpoint}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`
    debugLog(`[loadCodeAssist] Trying: ${url}`)
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        debugLog(`[loadCodeAssist] Failed: ${response.status} ${response.statusText}`)
        continue
      }
      const data = (await response.json()) as AntigravityLoadCodeAssistResponse
      debugLog(`[loadCodeAssist] Success: ${JSON.stringify(data)}`)
      return data
    } catch (err) {
      debugLog(`[loadCodeAssist] Error: ${err}`)
      continue
    }
  }
  debugLog(`[loadCodeAssist] All endpoints failed`)
  return null
}

async function onboardManagedProject(
  accessToken: string,
  tierId: string,
  projectId?: string,
  attempts = 10,
  delayMs = 5000
): Promise<string | undefined> {
  debugLog(`[onboardUser] Starting with tierId=${tierId}, projectId=${projectId || "none"}`)
  
  const metadata: Record<string, string> = { ...CODE_ASSIST_METADATA }
  if (projectId) metadata.duetProject = projectId

  const requestBody: Record<string, unknown> = { tierId, metadata }
  if (!isFreeTier(tierId)) {
    if (!projectId) {
      debugLog(`[onboardUser] Non-FREE tier requires projectId, returning undefined`)
      return undefined
    }
    requestBody.cloudaicompanionProject = projectId
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_HEADERS["User-Agent"],
    "X-Goog-Api-Client": ANTIGRAVITY_HEADERS["X-Goog-Api-Client"],
    "Client-Metadata": ANTIGRAVITY_HEADERS["Client-Metadata"],
  }

  debugLog(`[onboardUser] Request body: ${JSON.stringify(requestBody)}`)

  for (let attempt = 0; attempt < attempts; attempt++) {
    debugLog(`[onboardUser] Attempt ${attempt + 1}/${attempts}`)
    for (const baseEndpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
      const url = `${baseEndpoint}/${ANTIGRAVITY_API_VERSION}:onboardUser`
      debugLog(`[onboardUser] Trying: ${url}`)
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        })
        if (!response.ok) {
          const errorText = await response.text().catch(() => "")
          debugLog(`[onboardUser] Failed: ${response.status} ${response.statusText} - ${errorText}`)
          continue
        }

        const payload = (await response.json()) as AntigravityOnboardUserPayload
        debugLog(`[onboardUser] Response: ${JSON.stringify(payload)}`)
        const managedProjectId = payload.response?.cloudaicompanionProject?.id
        if (payload.done && managedProjectId) {
          debugLog(`[onboardUser] Success! Got managed project ID: ${managedProjectId}`)
          return managedProjectId
        }
        if (payload.done && projectId) {
          debugLog(`[onboardUser] Done but no managed ID, using original: ${projectId}`)
          return projectId
        }
        debugLog(`[onboardUser] Not done yet, payload.done=${payload.done}`)
      } catch (err) {
        debugLog(`[onboardUser] Error: ${err}`)
        continue
      }
    }
    if (attempt < attempts - 1) {
      debugLog(`[onboardUser] Waiting ${delayMs}ms before next attempt...`)
      await wait(delayMs)
    }
  }
  debugLog(`[onboardUser] All attempts exhausted, returning undefined`)
  return undefined
}

export async function fetchProjectContext(
  accessToken: string
): Promise<AntigravityProjectContext> {
  debugLog(`[fetchProjectContext] Starting...`)
  
  const cached = projectContextCache.get(accessToken)
  if (cached) {
    debugLog(`[fetchProjectContext] Returning cached result: ${JSON.stringify(cached)}`)
    return cached
  }

  const loadPayload = await callLoadCodeAssistAPI(accessToken)

  // If loadCodeAssist returns a project ID, use it directly
  if (loadPayload?.cloudaicompanionProject) {
    const projectId = extractProjectId(loadPayload.cloudaicompanionProject)
    debugLog(`[fetchProjectContext] loadCodeAssist returned project: ${projectId}`)
    if (projectId) {
      const result: AntigravityProjectContext = { cloudaicompanionProject: projectId }
      projectContextCache.set(accessToken, result)
      debugLog(`[fetchProjectContext] Using loadCodeAssist project ID: ${projectId}`)
      return result
    }
  }

  // No project ID from loadCodeAssist - try with fallback project ID
  if (!loadPayload) {
    debugLog(`[fetchProjectContext] loadCodeAssist returned null, trying with fallback project ID`)
    const fallbackPayload = await callLoadCodeAssistAPI(accessToken, ANTIGRAVITY_DEFAULT_PROJECT_ID)
    const fallbackProjectId = extractProjectId(fallbackPayload?.cloudaicompanionProject)
    if (fallbackProjectId) {
      const result: AntigravityProjectContext = { cloudaicompanionProject: fallbackProjectId }
      projectContextCache.set(accessToken, result)
      debugLog(`[fetchProjectContext] Using fallback project ID: ${fallbackProjectId}`)
      return result
    }
    debugLog(`[fetchProjectContext] Fallback also failed, using default: ${ANTIGRAVITY_DEFAULT_PROJECT_ID}`)
    return { cloudaicompanionProject: ANTIGRAVITY_DEFAULT_PROJECT_ID }
  }

  const currentTierId = loadPayload.currentTier?.id
  debugLog(`[fetchProjectContext] currentTier: ${currentTierId}, allowedTiers: ${JSON.stringify(loadPayload.allowedTiers)}`)
  
  if (currentTierId && !isFreeTier(currentTierId)) {
    // PAID tier - still use fallback if no project provided
    debugLog(`[fetchProjectContext] PAID tier detected (${currentTierId}), using fallback: ${ANTIGRAVITY_DEFAULT_PROJECT_ID}`)
    return { cloudaicompanionProject: ANTIGRAVITY_DEFAULT_PROJECT_ID }
  }

  const defaultTierId = getDefaultTierId(loadPayload.allowedTiers)
  const tierId = defaultTierId ?? "free-tier"
  debugLog(`[fetchProjectContext] Resolved tierId: ${tierId}`)

  if (!isFreeTier(tierId)) {
    debugLog(`[fetchProjectContext] Non-FREE tier (${tierId}) without project, using fallback: ${ANTIGRAVITY_DEFAULT_PROJECT_ID}`)
    return { cloudaicompanionProject: ANTIGRAVITY_DEFAULT_PROJECT_ID }
  }

  // FREE tier - onboard to get server-assigned managed project ID
  debugLog(`[fetchProjectContext] FREE tier detected (${tierId}), calling onboardUser...`)
  const managedProjectId = await onboardManagedProject(accessToken, tierId)
  if (managedProjectId) {
    const result: AntigravityProjectContext = {
      cloudaicompanionProject: managedProjectId,
      managedProjectId,
    }
    projectContextCache.set(accessToken, result)
    debugLog(`[fetchProjectContext] Got managed project ID: ${managedProjectId}`)
    return result
  }

  debugLog(`[fetchProjectContext] Failed to get managed project ID, using fallback: ${ANTIGRAVITY_DEFAULT_PROJECT_ID}`)
  return { cloudaicompanionProject: ANTIGRAVITY_DEFAULT_PROJECT_ID }
}

export function clearProjectContextCache(accessToken?: string): void {
  if (accessToken) {
    projectContextCache.delete(accessToken)
  } else {
    projectContextCache.clear()
  }
}

export function invalidateProjectContextByRefreshToken(_refreshToken: string): void {
  projectContextCache.clear()
  debugLog(`[invalidateProjectContextByRefreshToken] Cleared all project context cache due to refresh token invalidation`)
}
