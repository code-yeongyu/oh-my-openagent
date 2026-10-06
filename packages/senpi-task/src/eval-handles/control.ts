import type { CancelReceipt, HandleCallContext, HandleOutcome, HandleRef, HandleSnapshot, OutputRequest, OutputSnapshot } from "@code-yeongyu/senpi"
import { fenceRun, type TaskRecord } from "../state"
import type { CancelOptions, CancelOutcome, SendInput, SendOutcome } from "../steering/types"
import { renderTranscript } from "../tools/output/render"
import type { TranscriptReader } from "../tools/output/types"
import { EvalHandleHostError } from "./errors"
import { isPoolSettled, loadOwnedPool, poolOutcome, poolSnapshot, type PoolAccess } from "./pool-refs"
import { assertCurrentRun, isSettled, loadFencedTask, taskOutcome, taskSnapshot, type TaskReader } from "./task-refs"

export type TaskControl = TaskReader & {
  cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome>
  sendToTask(input: SendInput): Promise<SendOutcome>
}

export type ControlDeps = {
  readonly tasks: TaskControl
  readonly pools: PoolAccess
  readonly stateDir: string
  readonly transcriptReader: TranscriptReader
}

const CANCEL_REASON = "cancelled from an eval handle"
const DEFAULT_TAIL_LINES = 60
/** Machine-readable `host_status` values for a send that did not simply land on the handle's live run. */
export const SEND_HOST_STATUS = {
  /** The run ended while the message was delivered; a follow-up turn would be a newer epoch, so re-fetch to follow it. */
  deliveredAfterEnd: "delivered_after_run_ended",
} as const

/** Machine-readable `host_status` on a watch update for a ref whose run is gone (rolled back or replaced). */
export const WATCH_HOST_STATUS = {
  runGone: "no_longer_current_run",
} as const

export function resultOf(deps: ControlDeps, ref: HandleRef, ctx: HandleCallContext): HandleOutcome {
  if (ref.kind === "workpool") {
    const pool = loadOwnedPool(deps.pools, ref, ctx)
    if (!isPoolSettled(pool)) throw new EvalHandleHostError("eval_handle_pending", `${ref.id} is still running`)
    return poolOutcome(pool, ref)
  }
  const record = loadFencedTask(deps.tasks, agentRef(ref), ctx)
  if (!isSettled(record)) throw new EvalHandleHostError("eval_handle_pending", `${ref.id} is still ${record.status}`)
  return taskOutcome(record, ref)
}

export async function cancelRef(deps: ControlDeps, ref: HandleRef, ctx: HandleCallContext): Promise<CancelReceipt> {
  if (ref.kind === "workpool") {
    const pool = loadOwnedPool(deps.pools, ref, ctx)
    if (isPoolSettled(pool)) return { ref, cancelled: false, phase: poolSnapshot(pool, ref).phase }
    const cancelled = deps.pools.workpools.cancel(deps.pools.poolCaller(ctx.ownerSessionId), ref.id)
    return { ref, cancelled: true, phase: poolSnapshot(cancelled, ref).phase }
  }
  const before = loadFencedTask(deps.tasks, agentRef(ref), ctx)
  const outcome = await deps.tasks.cancelTask(ref.id, CANCEL_REASON, { expectedRunEpoch: ref.run_epoch })
  const run = afterEngine(deps.tasks.get(ref.id) ?? before, ref.run_epoch)
  switch (outcome.kind) {
    case "stale":
      throw staleError(run.record, ref)
    case "cancelled":
      // This ref's run was stopped; a newer run that started since is not what the receipt reports.
      return { ref, cancelled: true, phase: run.verdict === "live" ? taskSnapshot(run.record, ref).phase : "cancelled" }
    case "cancel_pending":
    case "noop":
    case "not_found":
      // Nothing was stopped yet: once the run has moved, any phase read now would be the next run's.
      if (run.verdict !== "live") throw staleError(run.record, ref)
      return { ref, cancelled: outcome.kind === "cancel_pending", phase: taskSnapshot(run.record, ref).phase }
  }
}

export async function sendRef(deps: ControlDeps, ref: HandleRef, message: string, ctx: HandleCallContext): Promise<HandleSnapshot> {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `send is for agent handles, not ${ref.kind}`)
  loadFencedTask(deps.tasks, ref, ctx)
  const outcome = await deps.tasks.sendToTask({ idOrName: ref.id, message, callerSessionId: ctx.ownerSessionId, expectedRunEpoch: ref.run_epoch })
  const record = deps.tasks.get(ref.id)
  if (record === undefined) throw new EvalHandleHostError("eval_handle_not_found", `no task ${ref.id}`)
  switch (outcome.kind) {
    case "revived":
      return deliveredReply(afterEngine(record, outcome.run_epoch), ref, `revived as epoch ${outcome.run_epoch}`)
    case "steered":
    case "queued":
      return deliveredReply(afterEngine(record, ref.run_epoch), ref, undefined)
    case "stale":
      throw staleError(record, ref)
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

type RunAfterEngine = {
  readonly record: TaskRecord
  readonly expectedEpoch: number
  /** `live`: still the run the engine acted on; `moved`: a newer run started; `rolledBack`: that run was undone. */
  readonly verdict: "live" | "moved" | "rolledBack"
}

/**
 * The one check every send and cancel reply goes through after the engine returns: the record is re-read, and a run
 * that moved past the epoch the engine acted on (a revive, or a follow-up turn starting) is named, never reported as
 * the run the caller asked about.
 */
export function afterEngine(record: TaskRecord, expectedEpoch: number): RunAfterEngine {
  const fence = fenceRun(record, expectedEpoch)
  const verdict = fence === "live" ? "live" : fence === "unknown" ? "rolledBack" : "moved"
  return { record, expectedEpoch, verdict }
}

function deliveredReply(run: RunAfterEngine, ref: HandleRef, deliveredStatus: string | undefined): HandleSnapshot {
  if (run.verdict === "rolledBack") {
    throw new EvalHandleHostError("eval_handle_send_refused", `${ref.id}: the run the message started was rolled back; fetch its current handle and send again`)
  }
  if (run.verdict === "moved") {
    // A newer run started before this read: hand back its ref, as a revive does, rather than its state under this one.
    const current = run.record.notification.run_epoch
    return taskSnapshot(run.record, { ...ref, run_epoch: current }, `continued as epoch ${current}`)
  }
  const target = { ...ref, run_epoch: run.expectedEpoch }
  if (deliveredStatus !== undefined) return taskSnapshot(run.record, target, deliveredStatus)
  // The run ended while the message was delivered: a follow-up turn would be a newer epoch this ref cannot follow.
  if (isSettled(run.record)) return taskSnapshot(run.record, target, SEND_HOST_STATUS.deliveredAfterEnd)
  return taskSnapshot(run.record, target)
}

export function outputOf(deps: ControlDeps, ref: HandleRef, request: OutputRequest, ctx: HandleCallContext): OutputSnapshot {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `output is for agent handles, not ${ref.kind}`)
  loadFencedTask(deps.tasks, ref, ctx)
  const read = deps.transcriptReader({ taskId: ref.id, stateDir: deps.stateDir })
  // A resume during the read would hand back the successor's transcript; re-fence after reading.
  loadFencedTask(deps.tasks, ref, ctx)
  const rendered = renderTranscript(read.entries, { mode: "full", tailLines: 0 })
  const lines = rendered.text.length === 0 ? [] : rendered.text.split("\n")
  const total = lines.length
  const [start, end] = window(request, total)
  return { ref, text: lines.slice(start, end).join("\n"), offset: start, total, truncated: rendered.truncated || read.truncated === true || start > 0 || end < total }
}

function window(request: OutputRequest, total: number): readonly [number, number] {
  if (request.format === "tail") {
    const count = request.limit ?? DEFAULT_TAIL_LINES
    return [Math.max(0, total - count), total]
  }
  const start = Math.min(Math.max(0, request.offset ?? 0), total)
  return [start, request.limit === undefined ? total : Math.min(total, start + request.limit)]
}

/** The engine's stale verdict as the host error: the fence names why (a newer run, or a pre-upgrade handle). */
function staleError(record: TaskRecord, ref: HandleRef): EvalHandleHostError {
  try {
    assertCurrentRun(record, ref)
  } catch (error) {
    if (error instanceof EvalHandleHostError) return error
    throw error
  }
  return new EvalHandleHostError("eval_handle_stale", `${ref.id} moved to epoch ${record.notification.run_epoch}; fetch its current handle`)
}

function agentRef(ref: HandleRef): HandleRef {
  if (ref.kind !== "agent") throw new EvalHandleHostError("eval_handle_operation_unsupported", `${ref.kind} refs are not served by the task host`)
  return ref
}
