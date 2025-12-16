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
} from "./constants"
import type {
  AntigravityProjectContext,
  AntigravityLoadCodeAssistResponse,
  AntigravityOnboardUserPayload,
  AntigravityUserTier,
} from "./types"

const projectContextCache = new Map<string, AntigravityProjectContext>()

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
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) continue
      return (await response.json()) as AntigravityLoadCodeAssistResponse
    } catch {
      continue
    }
  }
  return null
}

async function onboardManagedProject(
  accessToken: string,
  tierId: string,
  projectId?: string,
  attempts = 10,
  delayMs = 5000
): Promise<string | undefined> {
  const metadata: Record<string, string> = { ...CODE_ASSIST_METADATA }
  if (projectId) metadata.duetProject = projectId

  const requestBody: Record<string, unknown> = { tierId, metadata }
  if (tierId !== "FREE") {
    if (!projectId) return undefined
    requestBody.cloudaicompanionProject = projectId
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_HEADERS["User-Agent"],
    "X-Goog-Api-Client": ANTIGRAVITY_HEADERS["X-Goog-Api-Client"],
    "Client-Metadata": ANTIGRAVITY_HEADERS["Client-Metadata"],
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const baseEndpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
      const url = `${baseEndpoint}/${ANTIGRAVITY_API_VERSION}:onboardUser`
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        })
        if (!response.ok) continue

        const payload = (await response.json()) as AntigravityOnboardUserPayload
        const managedProjectId = payload.response?.cloudaicompanionProject?.id
        if (payload.done && managedProjectId) return managedProjectId
        if (payload.done && projectId) return projectId
      } catch {
        continue
      }
    }
    if (attempt < attempts - 1) await wait(delayMs)
  }
  return undefined
}

export async function fetchProjectContext(
  accessToken: string
): Promise<AntigravityProjectContext> {
  const cached = projectContextCache.get(accessToken)
  if (cached) return cached

  const loadPayload = await callLoadCodeAssistAPI(accessToken)

  // If loadCodeAssist returns a project ID, use it directly
  if (loadPayload?.cloudaicompanionProject) {
    const projectId = extractProjectId(loadPayload.cloudaicompanionProject)
    if (projectId) {
      const result: AntigravityProjectContext = { cloudaicompanionProject: projectId }
      projectContextCache.set(accessToken, result)
      return result
    }
  }

  // No project ID from loadCodeAssist - check tier and onboard if FREE
  if (!loadPayload) {
    return { cloudaicompanionProject: "" }
  }

  const currentTierId = loadPayload.currentTier?.id
  if (currentTierId && currentTierId !== "FREE") {
    // PAID tier requires user-provided project ID
    return { cloudaicompanionProject: "" }
  }

  const defaultTierId = getDefaultTierId(loadPayload.allowedTiers)
  const tierId = defaultTierId ?? "FREE"

  if (tierId !== "FREE") {
    return { cloudaicompanionProject: "" }
  }

  // FREE tier - onboard to get server-assigned managed project ID
  const managedProjectId = await onboardManagedProject(accessToken, tierId)
  if (managedProjectId) {
    const result: AntigravityProjectContext = {
      cloudaicompanionProject: managedProjectId,
      managedProjectId,
    }
    projectContextCache.set(accessToken, result)
    return result
  }

  return { cloudaicompanionProject: "" }
}

export function clearProjectContextCache(accessToken?: string): void {
  if (accessToken) {
    projectContextCache.delete(accessToken)
  } else {
    projectContextCache.clear()
  }
}
