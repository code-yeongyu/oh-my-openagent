import type { AdmissionBarrier, ResumeCredential } from "../pause/admission-barrier"
import type { PauseParticipant } from "../pause/registry"
import type { TaskRecordStore } from "../store"
import type { TaskConcurrency } from "./concurrency"
import type { LaunchContext, LaunchOutcome } from "./launch-task"
import { buildRespawnManagedSpec, isTerminalRecord } from "./manager-helpers"
import { RunPauseAdmissionHeld } from "./run-pause"
import { enterStartAdmission } from "./start-admission"
import type { ManagedRunner } from "./types"

export type HeldAdmissionResult = { readonly kind: "resumed" } | { readonly kind: "settled" }

type HeldAdmissionPorts = {
  readonly store: TaskRecordStore
  readonly barrier: AdmissionBarrier
  readonly concurrency: TaskConcurrency
  readonly hostPid: number
  readonly runners: Readonly<Record<"in-process" | "process", ManagedRunner>>
  launch(context: LaunchContext): void
}

class HeldAdmissionError extends Error {
  readonly code = "held_admission_unavailable"
  constructor(readonly taskId: string, readonly reason: "record_missing" | "allocation_missing" | "already_started" | "spawn_spec_unavailable" | "owner_changed") {
    super(`held admission ${taskId}: ${reason}`)
  }
}

export class HeldAdmissions {
  readonly #contexts = new Map<string, LaunchContext>()
  readonly #ports: HeldAdmissionPorts

  constructor(ports: HeldAdmissionPorts) { this.#ports = ports }

  enqueue(context: LaunchContext): number {
    this.#contexts.set(context.record.task_id, context)
    return this.#ports.concurrency.enqueue(context.model, context.record.task_id, context.record.notification.run_epoch,
      () => this.#ports.launch(context))
  }

  track(context: LaunchContext, launching: Promise<LaunchOutcome>): void {
    this.#contexts.set(context.record.task_id, context)
    void launching.then(outcome => {
      if ("held" in outcome && outcome.held !== undefined) return
      this.#forgetContext(context)
    }, () => this.#forgetContext(context))
  }

  withdraw(taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      const record = this.#ports.store.load(taskId)
      if (record === null) continue
      const removed = this.#ports.concurrency.withdraw(record.model, taskId, record.notification.run_epoch)
      if (removed !== undefined) this.#contexts.get(taskId)?.managedSpec.admission?.leave()
    }
  }

  resume(participant: PauseParticipant, credential: ResumeCredential): HeldAdmissionResult {
    const taskId = participant.taskId
    if (taskId === undefined) throw new HeldAdmissionError(participant.key, "record_missing")
    const record = this.#ports.store.load(taskId)
    if (record === null) throw new HeldAdmissionError(taskId, "record_missing")
    if (isTerminalRecord(record) || record.notification.run_epoch !== participant.runEpoch) return { kind: "settled" }
    if (record.status !== "pending") throw new HeldAdmissionError(taskId, "already_started")
    const allocation = participant.admission
    if (allocation === undefined) throw new HeldAdmissionError(taskId, "allocation_missing")
    const warm = this.#contexts.get(taskId)
    const rebuilt = warm === undefined ? buildRespawnManagedSpec(record, this.#ports.store.stateDir) : undefined
    if (rebuilt !== undefined && !rebuilt.ok) throw new HeldAdmissionError(taskId, "spawn_spec_unavailable")
    const prepared = warm?.managedSpec ?? (rebuilt?.ok === true ? rebuilt.spec : undefined)
    if (prepared === undefined) throw new HeldAdmissionError(taskId, "spawn_spec_unavailable")
    const entered = enterStartAdmission({
      barrier: this.#ports.barrier, taskId, runRef: participant.runRef, credential,
      spec: {
        prompt: prepared.prompt, parent_session_id: record.parent_session_id,
        ...(record.root_session_id === undefined ? {} : { root_session_id: record.root_session_id }),
        depth: record.depth,
      },
    })
    if (entered.kind === "held") throw new RunPauseAdmissionHeld()
    try {
      let claimed = false
      const owned = this.#ports.store.mutate(taskId, fresh => {
        if (fresh.status !== "pending" || fresh.notification.run_epoch !== record.notification.run_epoch ||
          fresh.host_pid !== record.host_pid) return fresh
        claimed = true
        return { ...fresh, host_pid: this.#ports.hostPid }
      })
      if (!claimed || owned === null) throw new HeldAdmissionError(taskId, "owner_changed")
      const context: LaunchContext = {
        record: owned, managedSpec: { ...prepared, admission: entered.scope },
        runner: warm?.runner ?? this.#ports.runners[owned.execution_mode === "in-process" ? "in-process" : "process"],
        model: allocation.model,
      }
      this.#contexts.set(taskId, context)
      this.#ports.concurrency.requeue({
        taskId, runEpoch: owned.notification.run_epoch, model: allocation.model,
        laneKey: allocation.laneKey, sequence: allocation.sequence,
      }, () => this.#ports.launch(context))
      entered.scope.transfer()
      this.#ports.concurrency.drain()
      return { kind: "resumed" }
    } finally {
      if (!entered.transferred()) entered.scope.leave()
    }
  }

  forget(taskId: string): void { this.#contexts.delete(taskId) }

  #forgetContext(context: LaunchContext): void {
    if (this.#contexts.get(context.record.task_id) === context) this.#contexts.delete(context.record.task_id)
  }
}
