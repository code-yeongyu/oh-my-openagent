// Recovery of a reflection reservation whose holder died after this session already reconciled (#10377, #11976).
//
// Session-start reconciliation runs once per session (wiring.ts onSettled), so a holder that dies
// later leaves runtime/reflection/active.lock held, and every later request only queues behind it.
// The shared reaper (memory-core reflection/stale-lock-reaper.ts, also run by `omo doctor --fix`)
// decides, fail-closed, whether that holder is provably gone; a dead holder and the reapable stuck
// shapes (launch interrupted, processes dead, unreadable ledger) are settled by reconciliation, a torn
// lock is moved aside. Anything it cannot prove is reported with the next step, never silently kept.

import {
  classifyReflectionLockHolder,
  runStaleLockReaper,
  type ReflectionLockVerdict,
  type StaleLockProbe,
} from "@oh-my-opencode/memory-core"
import { dirname } from "node:path"

export type ActiveHolderVerdict = ReflectionLockVerdict
export type ActiveHolderSeams = StaleLockProbe

/** The shared decision (memory-core reflection/stale-holder.ts); `omo doctor` runs the same code. */
export function classifyActiveReflectionHolder(reflectionDir: string, seams: ActiveHolderSeams = {}): Promise<ActiveHolderVerdict> {
  return classifyReflectionLockHolder(reflectionDir, seams)
}

export function staleReflectionLockNotice(_reflectionDir: string, verdict: { readonly runId: string; readonly reason: string }): string {
  return `memory reflection is stuck on a stale lock: run ${verdict.runId} still holds it and ${verdict.reason}, so new reflection requests only queue. Next step: run /doctor; if no reflection run is active, run \`omo doctor --fix\`, which releases a provably dead holder and moves a torn lock aside.`
}

const NOT_RELEASED = "recovering it did not release the lock"

/**
 * Settles or reaps a provably gone holder; reports any other non-live holder. Returns the notice text
 * when the stuck state must be shown, and the run id it recovered when the lock was released.
 */
export async function recoverStaleReflectionHolder(input: {
  readonly reflectionDir: string
  readonly reconcile: () => Promise<void>
  readonly seams?: ActiveHolderSeams
  /** False once this session already tried to settle the run: report it instead of reconciling again. */
  readonly shouldReconcile?: (runId: string) => boolean
}): Promise<{ readonly verdict: ActiveHolderVerdict; readonly notice?: string; readonly recoveredRunId?: string }> {
  const report = await runStaleLockReaper({
    runtimeDir: dirname(input.reflectionDir),
    settle: input.reconcile,
    ...(input.seams === undefined ? {} : { probe: input.seams }),
    ...(input.shouldReconcile === undefined ? {} : { shouldSettle: input.shouldReconcile }),
  })
  const { decision, before, after } = report
  if (decision.kind === "none") return { verdict: before }
  if (report.action === "settle-declined") {
    return { verdict: before, notice: staleReflectionLockNotice(input.reflectionDir, { runId: decision.runId, reason: NOT_RELEASED }) }
  }
  if (report.action === "settled" || report.action === "reaped") {
    if (after.state === "stuck") return { verdict: after, notice: staleReflectionLockNotice(input.reflectionDir, after) }
    if (after.state === "dead" && after.runId === decision.runId) {
      return { verdict: after, notice: staleReflectionLockNotice(input.reflectionDir, { runId: after.runId, reason: NOT_RELEASED }) }
    }
    return { verdict: before, recoveredRunId: decision.runId }
  }
  const reason = decision.kind === "stuck" ? decision.reason : NOT_RELEASED
  return { verdict: before, notice: staleReflectionLockNotice(input.reflectionDir, { runId: decision.runId, reason }) }
}
