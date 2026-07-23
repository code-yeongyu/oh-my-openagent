import type { HookDeps } from "./types"

function ownershipCounts(deps: HookDeps): Map<string, number> {
  deps.internalAbortOwnershipCounts ??= new Map()
  return deps.internalAbortOwnershipCounts
}

export function acquireInternalAbortOwnership(deps: HookDeps, sessionID: string): void {
  const counts = ownershipCounts(deps)
  counts.set(sessionID, (counts.get(sessionID) ?? 0) + 1)
  deps.internallyAbortedSessions.add(sessionID)
}

export function releaseInternalAbortOwnership(deps: HookDeps, sessionID: string): boolean {
  const counts = ownershipCounts(deps)
  const count = counts.get(sessionID) ?? 0
  if (count > 1) {
    counts.set(sessionID, count - 1)
    return true
  }
  counts.delete(sessionID)
  return deps.internallyAbortedSessions.delete(sessionID)
}

export function consumeInternalAbortOwnership(deps: HookDeps, sessionID: string): boolean {
  if (!deps.internallyAbortedSessions.has(sessionID)) return false
  releaseInternalAbortOwnership(deps, sessionID)
  return true
}

export function clearInternalAbortOwnership(deps: HookDeps, sessionID: string): void {
  ownershipCounts(deps).delete(sessionID)
  deps.internallyAbortedSessions.delete(sessionID)
}

export function clearAllInternalAbortOwnership(deps: HookDeps): void {
  ownershipCounts(deps).clear()
  deps.internallyAbortedSessions.clear()
}
