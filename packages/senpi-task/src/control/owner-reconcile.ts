import { RunPauseAdmissionHeld } from "../manager/run-pause"
import type { ResumeCredential } from "../pause/admission-barrier"
import type { RunPauseOwner } from "../pause/ports"
import type { TaskRecord } from "../state"
import type { CancelOutcome } from "../steering/types"
import type { ControlGuidance, ControlRegister, GuidanceOutcome } from "./control-schema"
import type { ControlOwnerPort, ReconcileAnswer, ReconcileResult } from "./owner-port"

const TERMINAL = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

const answer = (value: ReconcileAnswer): ReconcileResult => ({ kind: "answer", answer: value })
const refused = (reason: NonNullable<ReconcileAnswer["reason"]>, final: boolean): ReconcileResult =>
  answer({ state: "refused", reason, final })
const undelivered = (register: ControlRegister) =>
  (register.guidance ?? []).map(entry => ({ inputId: entry.inputId, outcome: "undelivered" as const }))

function statusAnswer(record: TaskRecord, register: ControlRegister): ReconcileResult {
  return answer({ state: record.status === "cancelled" ? "cancelled" : "settled", guidance: undelivered(register), final: true })
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined
}

// Owner-side order (design 3.3): addressing, then the cancel-final rule, then the barrier rule and
// the record checks of the register's phase. A thrown error is the caller's backoff path.
export async function reconcileRegister(port: ControlOwnerPort, register: ControlRegister): Promise<ReconcileResult> {
  const record = port.load(register.taskId)
  if (record === undefined || !port.holds(register.taskId) || record.host_pid !== port.hostPid || !port.ownsRecord(record)
    || (record.host_manager_instance !== undefined && record.host_manager_instance !== port.managerInstance)) return { kind: "unaddressed" }
  if (TERMINAL.has(record.status)) return statusAnswer(record, register)
  const flagged = record.cancel_requested !== undefined
  if (!flagged && record.notification.run_epoch !== register.runEpoch) return refused("epoch_moved", true)
  if (flagged || register.phase === "cancelled") {
    if (!port.inAncestry(record, register.parentSessionId)) return refused("not_in_ancestry", true)
    const outcome = flagged
      ? await port.cancelTask(register.taskId, record.cancel_requested?.reason)
      : await port.cancelTask(register.taskId, register.cancel?.reason, { expectedRunEpoch: register.runEpoch })
    return cancelAnswer(port, register, outcome)
  }
  if (register.phase === "paused") return pause(port, record, register)
  return resume(port, record, register)
}

function cancelAnswer(port: ControlOwnerPort, register: ControlRegister, outcome: CancelOutcome): ReconcileResult {
  if (outcome.kind === "cancelled") return answer({ state: "cancelled", guidance: undelivered(register), final: true })
  if (outcome.kind === "stale") return refused("epoch_moved", true)
  const fresh = port.load(register.taskId)
  if (fresh !== undefined && TERMINAL.has(fresh.status)) return statusAnswer(fresh, register)
  return { kind: "retry" }
}

async function deliver(port: ControlOwnerPort, taskId: string, guidance: readonly ControlGuidance[]) {
  const outcomes: { inputId: string; outcome: GuidanceOutcome }[] = []
  for (const entry of guidance) {
    const held = await port.holdTaskInput(taskId, entry)
    outcomes.push({ inputId: entry.inputId, outcome: held.kind === "held" ? (held.duplicate ? "duplicate" : "delivered")
      : held.kind === "already_delivered" ? "already_delivered" : "undelivered" })
  }
  return outcomes
}

function ownerOf(register: ControlRegister, pauseSeq: number = register.pauseSeq): RunPauseOwner {
  return { parentSessionId: register.parentSessionId, parentPauseSeq: pauseSeq, runRef: register.runRef }
}

async function pause(port: ControlOwnerPort, record: TaskRecord, register: ControlRegister): Promise<ReconcileResult> {
  if (!port.inAncestry(record, register.parentSessionId)) return refused("not_in_ancestry", true)
  const saved = record.run_pause
  const alreadyHeld = record.status === "paused" && saved?.parent_session_id === register.parentSessionId
    && saved.parent_pause_seq >= register.pauseSeq
  if (!alreadyHeld) {
    if (!port.holds(register.taskId)) return refused("handle_gone", false)
    let ack
    try { ack = await port.pauseTask(register.taskId, ownerOf(register)) } catch (error) {
      return pauseError(error)
    }
    if ("refused" in ack) return ack.refused === "wrong_parent" ? answer({ state: "settled", final: true }) : refused("handle_gone", false)
  }
  const guidance = await deliver(port, register.taskId, register.guidance ?? [])
  const observed = await port.observeTaskHold(register.taskId, register.parentSessionId)
  return answer({ state: "held", childSeq: observed?.childSeq ?? 0, guidance, final: false })
}

function pauseError(error: unknown): ReconcileResult {
  if (errorCode(error) === "native_pause_unavailable") return refused("native_pause_unavailable", false)
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith("cannot pause ")) return answer({ state: "settled", final: true })
  if (message.includes("changed while")) return { kind: "retry" }
  throw error
}

async function resume(port: ControlOwnerPort, record: TaskRecord, register: ControlRegister): Promise<ReconcileResult> {
  const root = record.root_session_id ?? record.parent_session_id
  const own = port.barrier?.state(root)
  if (own !== undefined && own.kind !== "open") {
    if (own.pauseSeq > register.pauseSeq) return answer({ state: "held_by_user", reason: "owner_held", final: false })
    if (register.parentSessionId === root) return { kind: "release_own_stop", root, ownSeq: own.pauseSeq }
  }
  return resumeRecord(port, record, register)
}

// The record checks of a `resumed` register, also run for each child inside an own-Stop release.
export async function resumeRecord(port: ControlOwnerPort, record: TaskRecord, register: ControlRegister,
  credential?: ResumeCredential): Promise<ReconcileResult> {
  const resumeId = register.resumeId ?? ""
  if (record.status === "running") {
    const done = record.run_pause_resumed
    if (record.run_pause === undefined && done?.resume_id === resumeId && done.parent_session_id === register.parentSessionId) {
      return answer({ state: "resumed", guidance: undelivered(register), final: true })
    }
    if ((register.guidance ?? []).length === 0) return answer({ state: "resumed", final: true })
    const paused = await pause(port, record, { ...register, phase: "paused" })
    if (paused.kind !== "answer" || paused.answer.state !== "held") return paused
    const fresh = port.load(register.taskId)
    return fresh === undefined ? { kind: "retry" } : resumeRecord(port, fresh, { ...register, guidance: [] }, credential)
  }
  const saved = record.run_pause
  if (saved === undefined || saved.parent_session_id !== register.parentSessionId
    || saved.run_ref.kind !== register.runRef.kind || saved.run_ref.id !== register.runRef.id
    || saved.parent_pause_seq > register.pauseSeq) return refused("stale", false)
  if (!port.holds(register.taskId)) return refused("handle_gone", false)
  const guidance = await deliver(port, register.taskId, register.guidance ?? [])
  const observed = await port.observeTaskHold(register.taskId, register.parentSessionId)
  try {
    const result = await port.resumePausedTask(register.taskId, {
      ...ownerOf(register, saved.parent_pause_seq), resumeId, childSeqCutoff: observed?.childSeq ?? 0,
      ...(credential === undefined ? {} : { resumeCredential: credential }),
    })
    if ("otherHoldLive" in result) {
      return answer({ state: "held_by_user", ...(result.childSeq === undefined ? {} : { childSeq: result.childSeq }), guidance, final: false })
    }
    return answer({ state: "resumed", turnId: result.turnId, guidance, final: true })
  } catch (error) {
    if (error instanceof RunPauseAdmissionHeld || (error instanceof Error && error.message.includes("changed while"))) return { kind: "retry" }
    throw error
  }
}
