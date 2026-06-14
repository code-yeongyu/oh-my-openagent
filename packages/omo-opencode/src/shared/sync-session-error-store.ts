const syncSessionErrors = new Map<string, string>()
const delegateTaskSyncSessions = new Set<string>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function firstMessageCandidate(candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate
    if (isRecord(candidate) && typeof candidate.message === "string" && candidate.message.length > 0) {
      return candidate.message
    }
  }
  return undefined
}

function extractSafeSessionErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error
  if (error instanceof Error) return error.message || error.name || "Session error"

  if (isRecord(error)) {
    const data = error.data
    const message = firstMessageCandidate([
      data,
      isRecord(data) ? data.error : undefined,
      error.error,
      error.cause,
      error,
    ])
    if (message) return message
    if (typeof error.name === "string" && error.name.length > 0) return error.name
  }

  return "Session error"
}

export function registerDelegateTaskSyncSession(sessionID: string): void {
  delegateTaskSyncSessions.add(sessionID)
}

export function clearDelegateTaskSyncSession(sessionID: string): void {
  delegateTaskSyncSessions.delete(sessionID)
}

export function isDelegateTaskSyncSession(sessionID: string): boolean {
  return delegateTaskSyncSessions.has(sessionID)
}

export function recordSyncSessionError(sessionID: string, error: unknown): void {
  syncSessionErrors.set(sessionID, extractSafeSessionErrorMessage(error))
}

export function consumeSyncSessionError(sessionID: string): string | undefined {
  if (!syncSessionErrors.has(sessionID)) return undefined

  const error = syncSessionErrors.get(sessionID)
  syncSessionErrors.delete(sessionID)
  return error
}

export function clearSyncSessionError(sessionID: string): void {
  syncSessionErrors.delete(sessionID)
}

export function clearAllSyncSessionErrorsForTesting(): void {
  syncSessionErrors.clear()
  delegateTaskSyncSessions.clear()
}
