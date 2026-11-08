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
  type ReflectionLockVerdict,
  type StaleLockProbe,
} from "@oh-my-opencode/memory-core"
import { dirname } from "node:path"

import { loadMemoryCommandsRuntime, type ReflectionLockRuntimeModule } from "./commands/runtime-loader"

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
  // No lock or a live holder is the reaper's "nothing to decide"; answering it here keeps the per-turn
  // check from loading the commands sidecar while no reflection lock needs recovery.
  const current = await classifyReflectionLockHolder(input.reflectionDir, input.seams ?? {})
  if (current.state === "none" || current.state === "live") return { verdict: current }
  const { runStaleLockReaper } = await loadMemoryCommandsRuntime()
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

/**
 * The once-per-session reconcile: the reaper moves a torn active.lock aside first (reconciliation cannot read past
 * it), then reconciles. When the commands sidecar cannot load (a damaged install), the load failure is reported
 * and the reconcile still runs directly, so every session keeps reconciling once.
 */
export async function reconcileThroughStaleLockReaper(input: {
  readonly runtimeDir: string
  readonly reconcile: () => Promise<void>
  readonly probe?: StaleLockProbe
  readonly onLoadFailure: (error: unknown) => void
  readonly loadRuntime?: () => Promise<Pick<ReflectionLockRuntimeModule, "runStaleLockReaper">>
}): Promise<void> {
  let runtime: Pick<ReflectionLockRuntimeModule, "runStaleLockReaper">
  try {
    runtime = await (input.loadRuntime ?? loadMemoryCommandsRuntime)()
  } catch (error) {
    input.onLoadFailure(error)
    await input.reconcile()
    return
  }
  await runtime.runStaleLockReaper({
    runtimeDir: input.runtimeDir,
    settle: input.reconcile,
    settleAlways: true,
    ...(input.probe === undefined ? {} : { probe: input.probe }),
  })
}
