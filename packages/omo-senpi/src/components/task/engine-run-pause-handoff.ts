import type { TaskManager } from "../../../../senpi-task/src/manager/types"
import type { TaskPauseMethods } from "../../../../senpi-task/src/manager/run-pause"
import type { ResumeCredential } from "../../../../senpi-task/src/pause/admission-barrier"
import type { RunPauseOwner } from "../../../../senpi-task/src/pause/ports"
import type { PauseParticipant } from "../../../../senpi-task/src/pause/registry"
import type { ResumeParticipantRequest } from "../../../../senpi-task/src/pause/run-controller"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import type { TaskRecordStore } from "../../../../senpi-task/src/store"

type HandoffPorts = {
  readonly manager: TaskManager & TaskPauseMethods
  readonly store?: TaskRecordStore
  readonly isProcessAlive?: (pid: number) => boolean
  readonly armCancelWatcher?: (taskId: string) => void
}

const namesRun = (record: TaskRecord, owner: RunPauseOwner): boolean =>
  record.run_pause?.parent_session_id === owner.parentSessionId
  && record.run_pause.run_ref.kind === owner.runRef.kind && record.run_pause.run_ref.id === owner.runRef.id

// The dead-owner handoff (design 3.2): a formerly remote child whose owner died or let it go is
// handed to the local path, decided per FRESH record. It never restores or resumes a flagged record.
export function createOwnerHandoff(ports: HandoffPorts) {
  // ALIGN: a record paused at another seq of this run is re-saved at the ledger's seq, guarded so a
  // live other process that took the record meanwhile keeps it.
  function align(record: TaskRecord, owner: RunPauseOwner): boolean {
    if (record.run_pause?.parent_pause_seq === owner.parentPauseSeq || ports.store === undefined) return true
    let aligned = false
    ports.store.mutate(record.task_id, fresh => {
      const owned = fresh.host_pid !== undefined && fresh.host_pid !== record.host_pid && ports.isProcessAlive?.(fresh.host_pid) === true
      if (owned || fresh.run_pause === undefined) return fresh
      aligned = true
      return { ...fresh, run_pause: { ...fresh.run_pause, parent_pause_seq: owner.parentPauseSeq } }
    })
    return aligned
  }

  function flagged(record: TaskRecord): boolean {
    if (record.cancel_requested === undefined) return false
    ports.armCancelWatcher?.(record.task_id)
    return true
  }

  async function hold(_participant: PauseParticipant, record: TaskRecord, owner: RunPauseOwner) {
    if (flagged(record)) return { kind: "settled" as const }
    if (record.status === "paused" && namesRun(record, owner)) return align(record, owner) ? { kind: "held" as const, childSeq: 0 } : undefined
    if (record.status !== "running") return { kind: "settled" as const }
    const ack = await ports.manager.pauseTask(record.task_id, owner)
    return "refused" in ack ? { kind: "settled" as const } : { kind: "held" as const, childSeq: ack.childSeq }
  }

  async function resume(participant: PauseParticipant, record: TaskRecord, request: ResumeParticipantRequest, credential: ResumeCredential | undefined) {
    if (flagged(record)) return { kind: "settled" as const }
    if (record.status !== "paused" || !namesRun(record, request) || !align(record, request)) return { kind: "settled" as const }
    for (const entry of participant.guidance ?? []) await ports.manager.holdTaskInput(record.task_id, entry)
    const resumed = await ports.manager.resumeLostTask(record.task_id, { ...request, ...(credential === undefined ? {} : { resumeCredential: credential }) })
    if ("notHeld" in resumed) return { kind: "settled" as const }
    if ("otherHoldLive" in resumed) return { kind: "held_by_user" as const, childSeq: resumed.childSeq ?? 0 }
    return { kind: "resumed" as const, turnId: resumed.turnId }
  }

  return { hold, resume }
}
