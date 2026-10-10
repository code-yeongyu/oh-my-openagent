import type { HandleCallContext, HandlePhase, HandleRef, HandleSnapshot } from "@code-yeongyu/senpi"
import { fenceRun, type TaskRecord } from "../state"
import { EvalHandleHostError } from "./errors"
import { assertCurrentRun, isSettled, loadFencedTask, taskSnapshot, type TaskReader } from "./task-refs"

/** Machine-readable `host_status` values for a send that did not simply land on the handle's live run. */
export const SEND_HOST_STATUS = {
  /** The run ended while the message was delivered; a follow-up turn would be a newer epoch, so re-fetch to follow it. */
  deliveredAfterEnd: "delivered_after_run_ended",
} as const

/**
 * The run a send or cancel acted on, re-read after the engine returned. The record stays private: a send or cancel
 * reply can describe the task only through this value, so no reply can be built from a record that skipped the check.
 * A run that moved past the epoch the engine acted on (a revive, or a follow-up turn starting) is named as such,
 * never reported as the run the caller asked about.
 */
class RunAfterEngine {
  readonly #record: TaskRecord
  readonly #expectedEpoch: number
  /** `live`: still the run the engine acted on; `moved`: a newer run started; `rolledBack`: that run was undone. */
  readonly verdict: "live" | "moved" | "rolledBack"

  constructor(record: TaskRecord, expectedEpoch: number) {
    this.#record = record
    this.#expectedEpoch = expectedEpoch
    const fence = fenceRun(record, expectedEpoch)
    this.verdict = fence === "live" ? "live" : fence === "unknown" ? "rolledBack" : "moved"
  }

  /** The phase of the task as it is now. */
  phase(ref: HandleRef): HandlePhase {
    return taskSnapshot(this.#record, ref).phase
  }

  /** The engine's stale verdict as the host error: the fence names why (a newer run, or a pre-upgrade handle). */
  stale(ref: HandleRef): EvalHandleHostError {
    try {
      assertCurrentRun(this.#record, ref)
    } catch (error) {
      if (error instanceof EvalHandleHostError) return error
      throw error
    }
    return new EvalHandleHostError("eval_handle_stale", `${ref.id} moved to epoch ${this.#record.notification.run_epoch}; fetch its current handle`)
  }

  /** The reply for a message the engine delivered (or revived the task with). */
  delivered(ref: HandleRef, deliveredStatus: string | undefined): HandleSnapshot {
    if (this.verdict === "rolledBack") {
      throw new EvalHandleHostError("eval_handle_send_refused", `${ref.id}: the run the message started was rolled back; fetch its current handle and send again`)
    }
    if (this.verdict === "moved") {
      // A newer run started before this read: hand back its ref, as a revive does, rather than its state under this one.
      const current = this.#record.notification.run_epoch
      return taskSnapshot(this.#record, { ...ref, run_epoch: current }, `continued as epoch ${current}`)
    }
    const target = { ...ref, run_epoch: this.#expectedEpoch }
    if (deliveredStatus !== undefined) return taskSnapshot(this.#record, target, deliveredStatus)
    // The run ended while the message was delivered: a follow-up turn would be a newer epoch this ref cannot follow.
    if (isSettled(this.#record)) return taskSnapshot(this.#record, target, SEND_HOST_STATUS.deliveredAfterEnd)
    return taskSnapshot(this.#record, target)
  }
}

/** The fenced record from before the engine call, kept private; `reread` is the only way past the engine. */
class PriorRun {
  readonly #record: TaskRecord

  constructor(record: TaskRecord) {
    this.#record = record
  }

  /**
   * Re-reads the task once the engine returned and yields the run at any epoch. When the task is gone, `"prior"`
   * falls back to the record fenced before the call and `"not_found"` refuses.
   */
  reread(tasks: TaskReader, ifMissing: "prior" | "not_found"): (epoch: number) => RunAfterEngine {
    const fresh = tasks.get(this.#record.task_id)
    if (fresh === undefined && ifMissing === "not_found") throw new EvalHandleHostError("eval_handle_not_found", `no task ${this.#record.task_id}`)
    const record = fresh ?? this.#record
    return (epoch) => new RunAfterEngine(record, epoch)
  }
}

export type { PriorRun, RunAfterEngine }

/** Fences the ref before the engine is called (owner, current run). */
export function fenceBeforeEngine(tasks: TaskReader, ref: HandleRef, ctx: HandleCallContext): PriorRun {
  return new PriorRun(loadFencedTask(tasks, ref, ctx))
}
