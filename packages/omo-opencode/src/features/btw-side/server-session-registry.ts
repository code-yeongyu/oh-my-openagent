import { getBtwSideMetadata } from "./metadata"

const serverSideSessionIDs = new Set<string>()

export function trackBtwSideSession(session: {
  id: string
  metadata?: Record<string, unknown>
}): boolean {
  if (!getBtwSideMetadata(session)) return false
  markBtwSideSession(session.id)
  return true
}

export function markBtwSideSession(sessionID: string): void {
  serverSideSessionIDs.add(sessionID)
}

export function forgetBtwSideSession(sessionID: string): boolean {
  return serverSideSessionIDs.delete(sessionID)
}

export function isTrackedBtwSideSession(sessionID: string): boolean {
  return serverSideSessionIDs.has(sessionID)
}

export function resetBtwSideSessionRegistryForTesting(): void {
  serverSideSessionIDs.clear()
}

