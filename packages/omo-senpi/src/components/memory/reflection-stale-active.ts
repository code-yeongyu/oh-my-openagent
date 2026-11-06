// Recovery of a reflection reservation whose holder died after this session already reconciled (#10377).
//
// Session-start reconciliation runs once per session (wiring.ts onSettled), so a host that dies
// mid-publish later leaves runtime/reflection/active.lock held, and every later request only
// queues behind it. This module decides, fail-closed, whether that holder is provably gone; only
// then is the existing reconciliation asked to settle the run. Reconciliation stays the only code
// that settles a run. When liveness cannot be proven either way, nothing is reclaimed and the
// stuck state is reported with the next step instead, so the stop is never silent.

import { classifyReflectionLockHolder, type ReflectionLockProbe, type ReflectionLockVerdict } from "@oh-my-opencode/memory-core"
import { join } from "node:path"

export type ActiveHolderVerdict = ReflectionLockVerdict
export type ActiveHolderSeams = ReflectionLockProbe

/** The shared decision (memory-core reflection/stale-holder.ts); `omo doctor` runs the same code. */
export function classifyActiveReflectionHolder(reflectionDir: string, seams: ActiveHolderSeams = {}): Promise<ActiveHolderVerdict> {
  return classifyReflectionLockHolder(reflectionDir, seams)
}

export function staleReflectionLockNotice(reflectionDir: string, verdict: { readonly runId: string; readonly reason: string }): string {
  return `memory reflection is stuck on a stale lock: run ${verdict.runId} still holds it and ${verdict.reason}, so new reflection requests only queue. Next step: run /doctor; if no reflection run is active, move ${join(reflectionDir, "active.lock")} aside (keep a backup) and start a new session.`
}

/**
 * Settles a provably dead holder through reconciliation; reports any other non-live holder.
 * Returns the notice text when the stuck state must be shown, otherwise undefined.
 */
export async function recoverStaleReflectionHolder(input: {
  readonly reflectionDir: string
  readonly reconcile: () => Promise<void>
  readonly seams?: ActiveHolderSeams
  /** False once this session already tried to settle the run: report it instead of reconciling again. */
  readonly shouldReconcile?: (runId: string) => boolean
}): Promise<{ readonly verdict: ActiveHolderVerdict; readonly notice?: string }> {
  const verdict = await classifyActiveReflectionHolder(input.reflectionDir, input.seams)
  if (verdict.state === "dead") {
    if (input.shouldReconcile?.(verdict.runId) === false) {
      return { verdict, notice: staleReflectionLockNotice(input.reflectionDir, { runId: verdict.runId, reason: "recovering it did not release the lock" }) }
    }
    await input.reconcile()
    const after = await classifyActiveReflectionHolder(input.reflectionDir, input.seams)
    if (after.state === "stuck") return { verdict: after, notice: staleReflectionLockNotice(input.reflectionDir, after) }
    if (after.state === "dead" && after.runId === verdict.runId) {
      return {
        verdict: after,
        notice: staleReflectionLockNotice(input.reflectionDir, { runId: after.runId, reason: "recovering it did not release the lock" }),
      }
    }
    return { verdict }
  }
  if (verdict.state === "stuck") return { verdict, notice: staleReflectionLockNotice(input.reflectionDir, verdict) }
  return { verdict }
}
