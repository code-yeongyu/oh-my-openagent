import { randomUUID } from "node:crypto"

import type { AdmissionBarrier } from "../pause/admission-barrier"
import type { EngineHoldInputResult, EngineInheritReceipt, RunPauseOwner } from "../pause/ports"
import type { TaskRecord } from "../state"
import type { SendOutcome } from "../steering"
import type { ManagedChildHandle } from "./child-handle"
import type { HeldTaskInput } from "./run-pause"

export type HeldSendPorts = {
  liveHandle(taskId: string): ManagedChildHandle | undefined
  pauseTask(taskId: string, owner: RunPauseOwner): Promise<EngineInheritReceipt>
  joinIdlePause(taskId: string, owner: RunPauseOwner): Promise<EngineInheritReceipt>
  holdTaskInput(taskId: string, input: HeldTaskInput): Promise<EngineHoldInputResult>
  noteParticipant(record: TaskRecord, owner: RunPauseOwner, childSeq: number): void
  load(taskId: string): TaskRecord | undefined
}

const SETTLED_RESIDENT = new Set(["completed", "error", "interrupted"])

export function holdsInChild(record: TaskRecord, ports: Pick<HeldSendPorts, "liveHandle">): boolean {
  if (record.status === "paused") return true
  if (record.killed === true || ports.liveHandle(record.task_id) === undefined) return false
  return record.status === "running" || (SETTLED_RESIDENT.has(record.status) && record.residency_state === "resident")
}

/**
 * A message to a child whose run is stopped never starts a turn (design 5.2): a child outside the
 * paused set first joins the pause as a participant under the run's current owner, then the message
 * becomes held input that the run's Resume delivers.
 */
export function createHeldSend(barrier: AdmissionBarrier, ports: HeldSendPorts) {
  return (record: TaskRecord, message: string): Promise<SendOutcome> | undefined => {
    const root = record.root_session_id ?? record.parent_session_id
    const state = barrier.state(root)
    // A live send never carries a Resume credential, so `resuming` holds it exactly like `closed`.
    if (state.kind === "open" || !holdsInChild(record, ports)) return undefined
    const runRef = record.owner === undefined ? { kind: "task" as const, id: record.task_id } : { kind: "dag" as const, id: record.owner.runId }
    return sendWhileHeld(ports, record, message, { parentSessionId: root, parentPauseSeq: state.pauseSeq, runRef })
  }
}

async function sendWhileHeld(ports: HeldSendPorts, record: TaskRecord, message: string, owner: RunPauseOwner): Promise<SendOutcome> {
  const taskId = record.task_id
  if (record.status !== "paused") {
    const ack = record.status === "running" ? await ports.pauseTask(taskId, owner) : await ports.joinIdlePause(taskId, owner)
    if ("refused" in ack) return {
      kind: "not_continuable", task_id: taskId,
      reason: `Task ${taskId} is paused for another parent's run; nothing was delivered.`,
      suggestion: "Resume the run that paused it, then send again.",
    }
    ports.noteParticipant(ports.load(taskId) ?? record, owner, ack.childSeq)
  }
  const held = await ports.holdTaskInput(taskId, { inputId: `send-${randomUUID()}`, revision: 0, text: message })
  if (held.kind !== "held") throw new Error(`held send for ${taskId} was answered ${held.kind}`)
  return { kind: "held", task_id: taskId, pause_seq: owner.parentPauseSeq, entry_id: held.entryId }
}
