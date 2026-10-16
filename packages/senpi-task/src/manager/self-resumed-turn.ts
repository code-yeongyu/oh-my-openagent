import { log } from "@oh-my-opencode/utils"

import { nextRunEpoch, type TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { buildRevived } from "../steering/engine-policy"
import type { ManagedChildHandle } from "./child-handle"
import { nowIso } from "./manager-helpers"

export type SelfResumedTurnPorts = {
  readonly store: TaskRecordStore
  readonly now: () => number
  readonly liveHandle: (taskId: string) => ManagedChildHandle | undefined
  readonly liveModel: (taskId: string) => string | undefined
  readonly tryLoad: (taskId: string) => TaskRecord | null
  readonly waitForTerminal: (taskId: string) => Promise<TaskRecord>
  readonly reserveForRevive: (taskId: string) => { readonly ok: false } | { readonly ok: true; commit(): void; release(): void }
  readonly trackOutcome: (taskId: string, handle: ManagedChildHandle, model: string, epoch: number) => void
}

function reopenable(record: TaskRecord | null, handle: ManagedChildHandle, ports: SelfResumedTurnPorts): record is TaskRecord {
  return (
    record !== null &&
    (record.status === "completed" || record.status === "error") &&
    record.residency_state === "resident" &&
    ports.liveHandle(record.task_id) === handle
  )
}

/**
 * A child whose turn already settled can start a run on its own - its monitor fired, its background
 * job finished (omo#9069). That run is work the parent has not seen, so the record goes back to
 * `running` under the next run_epoch (marked `resumed_run_epoch`) and outcome tracking is re-armed
 * exactly as a task_send revival does: the run's end becomes a second completion, announced as a
 * resumed turn's result. The earlier completion stays delivered. The settled outcome is persisted
 * first, so the reopen waits for it; a child that was cancelled, suspended or replaced meanwhile is
 * left alone.
 */
export async function reopenSelfResumedTurn(ports: SelfResumedTurnPorts, taskId: string, handle: ManagedChildHandle): Promise<void> {
  if (ports.liveHandle(taskId) !== handle) return
  await ports.waitForTerminal(taskId)
  const settled = ports.tryLoad(taskId)
  const model = ports.liveModel(taskId)
  if (!reopenable(settled, handle, ports) || model === undefined) return
  const epoch = nextRunEpoch(settled)
  const reservation = ports.reserveForRevive(taskId)
  let reopened = false
  ports.store.mutate(taskId, (fresh) => {
    if (!reopenable(fresh, handle, ports) || nextRunEpoch(fresh) !== epoch) return fresh
    reopened = true
    return { ...buildRevived(fresh, nowIso(ports.now)), resumed_run_epoch: epoch }
  })
  if (!reopened) {
    if (reservation.ok) reservation.release()
    return
  }
  ports.store.appendEvent(taskId, { type: "task_self_resumed", payload: { run_epoch: epoch } })
  // A resumed run is already doing its work: a full lane may deny it a slot, but never its result.
  if (reservation.ok) reservation.commit()
  else ports.trackOutcome(taskId, handle, model, epoch)
  log("senpi-task child resumed on its own after its turn settled", { taskId, runEpoch: epoch })
}
