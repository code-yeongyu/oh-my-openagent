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
export type RuntimeFallbackRecoveryDecision = "retry-owned" | "declined"

export const RUNTIME_FALLBACK_RECOVERY_DECISION_TIMEOUT_MS = 20_000

type RecoveryClaim = {
  readonly sessionID: string
  decision: RuntimeFallbackRecoveryDecision | undefined
  readonly waiters: Array<(decision: RuntimeFallbackRecoveryDecision) => void>
}

const recoveryClaims = new WeakMap<object, RecoveryClaim>()
let registeredOwners = 0

/** Called by the runtime-fallback hook for its lifetime. Without an owner no claim is ever opened. */
export function registerRuntimeFallbackRecoveryOwner(): () => void {
  registeredOwners += 1
  let released = false
  return () => {
    if (released) return
    released = true
    registeredOwners = Math.max(0, registeredOwners - 1)
  }
}

/** Called by the event dispatcher before any hook sees the event. */
export function openRuntimeFallbackRecoveryClaim(event: object, sessionID: string): void {
  if (registeredOwners === 0 || recoveryClaims.has(event)) return
  recoveryClaims.set(event, { sessionID, decision: undefined, waiters: [] })
}

/** Called by the runtime-fallback hook once it has finished handling the event. */
export function settleRuntimeFallbackRecoveryClaim(
  event: object,
  decision: RuntimeFallbackRecoveryDecision,
): void {
  const claim = recoveryClaims.get(event)
  if (!claim || claim.decision !== undefined) return
  claim.decision = decision
  for (const resolve of claim.waiters.splice(0)) {
    resolve(decision)
  }
}

/**
 * Called by consumers that would otherwise terminalize on the event. Returns
 * undefined when no claim was opened for it, so callers pay no extra await in
 * that case. A claim that is never settled resolves as `declined` after the
 * timeout, which is the behavior from before arbitration existed.
 */
export function awaitRuntimeFallbackRecoveryDecision(
  event: object,
  timeoutMs: number = RUNTIME_FALLBACK_RECOVERY_DECISION_TIMEOUT_MS,
): Promise<RuntimeFallbackRecoveryDecision> | undefined {
  const claim = recoveryClaims.get(event)
  if (!claim) return undefined
  if (claim.decision !== undefined) return Promise.resolve(claim.decision)

  return new Promise((resolve) => {
    const onDecision = (decision: RuntimeFallbackRecoveryDecision) => {
      clearTimeout(timer)
      resolve(decision)
    }
    const timer = setTimeout(() => {
      const index = claim.waiters.indexOf(onDecision)
      if (index >= 0) claim.waiters.splice(index, 1)
      log("[runtime-fallback-recovery] Recovery decision timed out; treating as declined", {
        sessionID: claim.sessionID,
        timeoutMs,
      })
      resolve("declined")
    }, timeoutMs)
    claim.waiters.push(onDecision)
  })
}

export function _resetRuntimeFallbackRecoveryForTesting(): void {
  registeredOwners = 0
}
