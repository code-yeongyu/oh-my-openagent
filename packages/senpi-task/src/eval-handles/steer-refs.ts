import type { CancelReceipt, HandleCallContext, HandleRef, HandleSnapshot } from "@code-yeongyu/senpi"
import type { CancelOptions, CancelOutcome, SendInput, SendOutcome } from "../steering/types"
import { EvalHandleHostError } from "./errors"
import { isPoolSettled, loadOwnedPool, poolSnapshot, type PoolAccess } from "./pool-refs"
import { fenceBeforeEngine } from "./run-after-engine"
import type { TaskReader } from "./task-refs"

/**
 * Send and cancel: the two operations that call the engine. No task record is in scope here - every reply comes from
 * the run re-read after the engine returned (`run-after-engine.ts`), so none can describe a run that moved or was undone.
 */
export type TaskControl = TaskReader & {
  cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome>
  sendToTask(input: SendInput): Promise<SendOutcome>
}

export type SteerDeps = { readonly tasks: TaskControl; readonly pools: PoolAccess }

const CANCEL_REASON = "cancelled from an eval handle"

export async function cancelRef(deps: SteerDeps, ref: HandleRef, ctx: HandleCallContext): Promise<CancelReceipt> {
  if (ref.kind === "workpool") {
    const pool = loadOwnedPool(deps.pools, ref, ctx)
    if (isPoolSettled(pool)) return { ref, cancelled: false, phase: poolSnapshot(pool, ref).phase }
    const cancelled = deps.pools.workpools.cancel(deps.pools.poolCaller(ctx.ownerSessionId), ref.id)
    return { ref, cancelled: true, phase: poolSnapshot(cancelled, ref).phase }
  }
  const prior = fenceBeforeEngine(deps.tasks, agentRef(ref), ctx)
  const outcome = await deps.tasks.cancelTask(ref.id, CANCEL_REASON, { expectedRunEpoch: ref.run_epoch })
  const run = prior.reread(deps.tasks, "prior")(ref.run_epoch)
  switch (outcome.kind) {
    case "stale":
      throw run.stale(ref)
    case "cancelled":
      // This ref's run was stopped; a newer run that started since is not what the receipt reports.
      return { ref, cancelled: true, phase: run.verdict === "live" ? run.phase(ref) : "cancelled" }
    case "cancel_pending":
    case "noop":
    case "released":
    case "not_found":
      // Nothing was stopped yet: once the run has moved, any phase read now would be the next run's.
      if (run.verdict !== "live") throw run.stale(ref)
      return { ref, cancelled: outcome.kind === "cancel_pending", phase: run.phase(ref) }
  }
}

export async function sendRef(deps: SteerDeps, ref: HandleRef, message: string, ctx: HandleCallContext): Promise<HandleSnapshot> {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `send is for agent handles, not ${ref.kind}`)
  const prior = fenceBeforeEngine(deps.tasks, ref, ctx)
  const outcome = await deps.tasks.sendToTask({ idOrName: ref.id, message, callerSessionId: ctx.ownerSessionId, expectedRunEpoch: ref.run_epoch })
  const runAt = prior.reread(deps.tasks, "not_found")
  switch (outcome.kind) {
    case "revived":
      return runAt(outcome.run_epoch).delivered(ref, `revived as epoch ${outcome.run_epoch}`)
    case "steered":
    case "queued":
      return runAt(ref.run_epoch).delivered(ref, undefined)
    case "stale":
      throw runAt(ref.run_epoch).stale(ref)
    case "scope_denied":
      throw new EvalHandleHostError("eval_handle_forbidden", outcome.reason)
    case "not_found":
      throw new EvalHandleHostError("eval_handle_not_found", outcome.reason)
    case "not_continuable":
      throw new EvalHandleHostError("eval_handle_send_refused", `${outcome.reason} ${outcome.suggestion}`)
    case "one_shot_agent":
      throw new EvalHandleHostError("eval_handle_send_refused", outcome.message)
    case "admission_refused":
    case "capacity_deferred":
    case "cwd_unavailable":
    case "config_generation_mismatch":
    case "delivery_uncertain":
      throw new EvalHandleHostError("eval_handle_send_refused", outcome.reason)
  }
}

function agentRef(ref: HandleRef): HandleRef {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `${ref.kind} refs are not served by the task host`)
  return ref
}
