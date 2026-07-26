import type { HookDeps } from "./types"

export type FallbackDispatchLease = {
  readonly sessionID: string
  readonly token: symbol
}

type FallbackDispatchLeaseOptions = {
  rejectAwaitingFallback?: boolean
}

const dispatchLeases = new WeakMap<HookDeps, Map<string, symbol>>()

function getDispatchLeases(deps: HookDeps): Map<string, symbol> {
  let leases = dispatchLeases.get(deps)
  if (!leases) {
    leases = new Map()
    dispatchLeases.set(deps, leases)
  }
  return leases
}

export function tryAcquireFallbackDispatchLease(
  deps: HookDeps,
  sessionID: string,
  options: FallbackDispatchLeaseOptions = {},
): FallbackDispatchLease | undefined {
  const leases = getDispatchLeases(deps)
  if (leases.has(sessionID)) return undefined
  if (deps.sessionRetryInFlight.has(sessionID)) return undefined
  if (options.rejectAwaitingFallback && deps.sessionAwaitingFallbackResult.has(sessionID)) return undefined

  const token = Symbol(sessionID)
  leases.set(sessionID, token)
  return { sessionID, token }
}

/**
 * Take ownership from an older dispatch while advancing a fallback chain.
 *
 * Timeout escalation and provider retry signals intentionally supersede a
 * request that is still awaiting OpenCode. Replacing the token lets every
 * older async branch observe that it became stale before it can submit a
 * prompt or restore obsolete state.
 */
export function supersedeFallbackDispatchLease(
  deps: HookDeps,
  sessionID: string,
): FallbackDispatchLease {
  const leases = getDispatchLeases(deps)
  const token = Symbol(sessionID)
  leases.set(sessionID, token)
  return { sessionID, token }
}

export function isFallbackDispatchLeaseOwner(
  deps: HookDeps,
  sessionID: string,
  lease: FallbackDispatchLease,
): boolean {
  return lease.sessionID === sessionID && dispatchLeases.get(deps)?.get(sessionID) === lease.token
}

export function releaseFallbackDispatchLease(
  deps: HookDeps,
  sessionID: string,
  lease: FallbackDispatchLease,
): void {
  if (!isFallbackDispatchLeaseOwner(deps, sessionID, lease)) return

  const leases = dispatchLeases.get(deps)
  leases?.delete(sessionID)
  if (leases?.size === 0) {
    dispatchLeases.delete(deps)
  }
}

/** Invalidate an active dispatch without granting a replacement owner. */
export function invalidateFallbackDispatchLease(deps: HookDeps, sessionID: string): void {
  const leases = dispatchLeases.get(deps)
  if (!leases) return

  leases.delete(sessionID)
  if (leases.size === 0) {
    dispatchLeases.delete(deps)
  }
}

/** Invalidate every active dispatch during plugin disposal. */
export function invalidateAllFallbackDispatchLeases(deps: HookDeps): void {
  dispatchLeases.delete(deps)
}
