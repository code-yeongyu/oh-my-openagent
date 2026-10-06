import type { HandleCallContext, HandleOutcome, HandlePhase, HandleRef, HandleSnapshot } from "@code-yeongyu/senpi"
import { fenceRun, type TaskRecord, type TaskStatus } from "../state"
import { EvalHandleHostError } from "./errors"

export type TaskReader = { get(taskId: string): TaskRecord | undefined }

const PHASES: Record<TaskStatus, HandlePhase> = {
  pending: "pending",
  running: "pending",
  completed: "succeeded",
  error: "failed",
  cancelled: "cancelled",
  interrupted: "cancelled",
  lost: "lost",
}

export function isSettled(record: TaskRecord): boolean {
  return PHASES[record.status] !== "pending"
}

export function loadFencedTask(tasks: TaskReader, ref: HandleRef, ctx: HandleCallContext): TaskRecord {
  const record = readTask(tasks, ref.id)
  if (record === undefined) throw new EvalHandleHostError("eval_handle_not_found", `no task ${ref.id}`)
  if (record.parent_session_id !== ctx.ownerSessionId) throw new EvalHandleHostError("eval_handle_forbidden", `${ref.id} belongs to another session`)
  assertCurrentRun(record, ref)
  return record
}

export function assertCurrentRun(record: TaskRecord, ref: HandleRef): void {
  switch (fenceRun(record, ref.run_epoch)) {
    case "live":
      return
    case "superseded":
      throw new EvalHandleHostError("eval_handle_stale", `${ref.id} started a newer run (epoch ${record.notification.run_epoch}); fetch its current handle`)
    case "legacy":
      throw new EvalHandleHostError("eval_handle_stale", `${ref.id}: handle from before the upgrade (epoch ${ref.run_epoch}, task now at ${record.notification.run_epoch}); re-fetch it`)
    case "unknown":
      throw new EvalHandleHostError("eval_handle_not_found", `${ref.id} never reached epoch ${ref.run_epoch}`)
  }
}

/** Revision: twice the run epoch, plus one once settled; a ref sees at most one change per epoch. */
export function taskSnapshot(record: TaskRecord, ref: HandleRef, hostStatus: string = record.status): HandleSnapshot {
  const settled = isSettled(record)
  return { ref, phase: PHASES[record.status], host_status: hostStatus, revision: record.notification.run_epoch * 2 + (settled ? 1 : 0) }
}

export function taskOutcome(record: TaskRecord, ref: HandleRef): HandleOutcome {
  if (record.status === "completed") return { status: "fulfilled", ref, value: record.final_response ?? "" }
  const message = record.error_message ?? `${ref.id} ended ${record.status}`
  return { status: "rejected", ref, error: { code: `task_${record.status}`, message } }
}

function readTask(tasks: TaskReader, taskId: string): TaskRecord | undefined {
  try {
    return tasks.get(taskId)
  } catch {
    return undefined
  }
}
