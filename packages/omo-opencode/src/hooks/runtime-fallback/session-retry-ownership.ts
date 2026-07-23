import type { HookDeps } from "./types"

export type SessionRetryOwnershipSnapshot = {
  readonly inFlight: boolean
  readonly owner: symbol | undefined
}

export function snapshotSessionRetryOwnership(
  deps: HookDeps,
  sessionID: string,
): SessionRetryOwnershipSnapshot {
  return {
    inFlight: deps.sessionRetryInFlight.has(sessionID),
    owner: deps.sessionRetryOwners?.get(sessionID),
  }
}

export function clearSessionRetryOwnershipIfUnchanged(
  deps: HookDeps,
  sessionID: string,
  snapshot: SessionRetryOwnershipSnapshot,
): boolean {
  if (deps.sessionRetryInFlight.has(sessionID) !== snapshot.inFlight) return false
  if (deps.sessionRetryOwners?.get(sessionID) !== snapshot.owner) return false
  clearSessionRetryOwnership(deps, sessionID)
  return true
}

export function acquireSessionRetryOwnership(deps: HookDeps, sessionID: string): symbol | undefined {
  if (deps.sessionRetryInFlight.has(sessionID)) return undefined
  const owner = Symbol(sessionID)
  deps.sessionRetryOwners ??= new Map()
  deps.sessionRetryOwners.set(sessionID, owner)
  deps.sessionRetryInFlight.add(sessionID)
  return owner
}

export function releaseSessionRetryOwnership(deps: HookDeps, sessionID: string, owner: symbol): void {
  if (deps.sessionRetryOwners?.get(sessionID) !== owner) return
  deps.sessionRetryOwners.delete(sessionID)
  deps.sessionRetryInFlight.delete(sessionID)
}

export function clearSessionRetryOwnership(deps: HookDeps, sessionID: string): void {
  deps.sessionRetryOwners?.delete(sessionID)
  deps.sessionRetryInFlight.delete(sessionID)
}

export function clearAllSessionRetryOwnership(deps: HookDeps): void {
  deps.sessionRetryOwners?.clear()
  deps.sessionRetryInFlight.clear()
}
