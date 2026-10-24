import { log } from "./logger"

/**
 * Arbitration between the runtime-fallback hook (same-session retry) and the
 * background manager (terminal error finalization) for one `session.error` event.
 *
 * The event dispatcher runs the background manager before runtime-fallback, and
 * runtime-fallback resolves its agent asynchronously before it decides anything,
 * so the manager cannot read runtime-fallback's state at the moment the error
 * arrives. Each `session.error` event therefore carries a claim: the dispatcher
 * opens it before any hook runs, runtime-fallback settles it once it has decided,
 * and the manager awaits it before finalizing the task.
 *
 * Claims are keyed by the event object, not by session or message id. Retry
 * prompts can reuse the original user message id, so neither a session id nor a
 * marker on a message can tell a stale error from the failure of the retry; the
 * event itself is the only identity that stays attached to one error.
 */
export type RuntimeFallbackRecoveryDecision = "retry-owned" | "declined" | "timed-out"

export const RUNTIME_FALLBACK_RECOVERY_DECISION_TIMEOUT_MS = 20_000

type SettledDecision = Exclude<RuntimeFallbackRecoveryDecision, "timed-out">

type RecoveryClaim = {
  readonly sessionID: string
  decision: SettledDecision | undefined
  readonly waiters: Array<(decision: SettledDecision) => void>
}

const recoveryClaims = new WeakMap<object, RecoveryClaim>()
const unsettledClaims = new Set<RecoveryClaim>()
let registeredOwners = 0

function settleClaim(claim: RecoveryClaim, decision: SettledDecision): void {
  if (claim.decision !== undefined) return
  claim.decision = decision
  unsettledClaims.delete(claim)
  for (const resolve of claim.waiters.splice(0)) {
    resolve(decision)
  }
}

/** Called by the runtime-fallback hook for its lifetime. Without an owner no claim is ever opened. */
export function registerRuntimeFallbackRecoveryOwner(): () => void {
  registeredOwners += 1
  let released = false
  return () => {
    if (released) return
    released = true
    registeredOwners = Math.max(0, registeredOwners - 1)
    if (registeredOwners > 0) return
    // No owner is left to decide, so nothing will settle the open claims: decline them now instead of
    // leaving each waiter to its timeout and the task to polling.
    for (const claim of [...unsettledClaims]) settleClaim(claim, "declined")
  }
}

/** Called by the event dispatcher before any hook sees the event. */
export function openRuntimeFallbackRecoveryClaim(event: object, sessionID: string): void {
  if (registeredOwners === 0 || recoveryClaims.has(event)) return
  const claim: RecoveryClaim = { sessionID, decision: undefined, waiters: [] }
  recoveryClaims.set(event, claim)
  unsettledClaims.add(claim)
}

/** Called by the runtime-fallback hook once it has finished handling the event. */
export function settleRuntimeFallbackRecoveryClaim(event: object, decision: SettledDecision): void {
  const claim = recoveryClaims.get(event)
  if (claim) settleClaim(claim, decision)
}

/**
 * Called by consumers that would otherwise terminalize on the event. Returns
 * undefined when no claim was opened for it, so callers pay no extra await in
 * that case. A timeout is not a refusal: the hook may still commit a dispatch.
 * Consumers must not start competing recovery on `timed-out`.
 */
export function awaitRuntimeFallbackRecoveryDecision(
  event: object,
  timeoutMs: number = RUNTIME_FALLBACK_RECOVERY_DECISION_TIMEOUT_MS,
): Promise<RuntimeFallbackRecoveryDecision> | undefined {
  const claim = recoveryClaims.get(event)
  if (!claim) return undefined
  if (claim.decision !== undefined) return Promise.resolve(claim.decision)

  return new Promise((resolve) => {
    const onDecision = (decision: SettledDecision) => {
      clearTimeout(timer)
      resolve(decision)
    }
    const timer = setTimeout(() => {
      const index = claim.waiters.indexOf(onDecision)
      if (index >= 0) claim.waiters.splice(index, 1)
      log("[runtime-fallback-recovery] Recovery decision timed out; withholding competing recovery", {
        sessionID: claim.sessionID,
        timeoutMs,
      })
      resolve("timed-out")
    }, timeoutMs)
    claim.waiters.push(onDecision)
  })
}

/**
 * The decision the hook settles after a waiter already timed out. Resolves once the claim is settled,
 * including by the last owner's release, so a late `declined` can still finalize the task.
 */
export function awaitLateRuntimeFallbackRecoveryDecision(event: object): Promise<SettledDecision> | undefined {
  const claim = recoveryClaims.get(event)
  if (!claim) return undefined
  if (claim.decision !== undefined) return Promise.resolve(claim.decision)
  return new Promise((resolve) => {
    claim.waiters.push(resolve)
  })
}

export function _resetRuntimeFallbackRecoveryForTesting(): void {
  registeredOwners = 0
  unsettledClaims.clear()
}
