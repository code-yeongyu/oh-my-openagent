import type { HookDeps } from "./types"

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
