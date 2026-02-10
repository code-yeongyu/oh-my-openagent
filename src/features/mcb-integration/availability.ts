import type { McbAvailabilityStatus, McbToolAvailability } from "./types"

let cachedStatus: McbAvailabilityStatus | null = null
let configLocked = false
const CACHE_TTL_MS = 60_000

export function lockMcbAvailability(): void {
  configLocked = true
}

export function getMcbAvailability(): McbAvailabilityStatus {
  if (cachedStatus && (configLocked || Date.now() - cachedStatus.checkedAt < CACHE_TTL_MS)) {
    return cachedStatus
  }

  cachedStatus = {
    available: true,
    checkedAt: Date.now(),
    tools: {
      search: true,
      memory: true,
      index: true,
      validate: true,
      vcs: true,
      session: false,
    },
  }

  return cachedStatus
}

export function markMcbUnavailable(tool?: keyof McbToolAvailability): void {
  if (!cachedStatus) {
    getMcbAvailability()
  }

  if (tool && cachedStatus) {
    cachedStatus.tools[tool] = false
  } else if (cachedStatus) {
    cachedStatus.available = false
  }
}

export function resetMcbAvailability(): void {
  cachedStatus = null
  configLocked = false
}
