export type CompactionRequestTracker = {
  mark: (sessionID: string) => void
  isActive: (sessionID: string) => boolean
  clear: (sessionID: string) => void
}

const DEFAULT_MARKER_TTL_MS = 5 * 60_000

export function createCompactionRequestTracker(
  markerTtlMs: number = DEFAULT_MARKER_TTL_MS,
): CompactionRequestTracker {
  const pending = new Map<string, number>()

  return {
    mark: (sessionID: string): void => {
      pending.set(sessionID, Date.now() + markerTtlMs)
    },
    isActive: (sessionID: string): boolean => {
      const expiresAt = pending.get(sessionID)
      if (expiresAt === undefined) return false
      if (expiresAt >= Date.now()) return true
      pending.delete(sessionID)
      return false
    },
    clear: (sessionID: string): void => {
      pending.delete(sessionID)
    },
  }
}
