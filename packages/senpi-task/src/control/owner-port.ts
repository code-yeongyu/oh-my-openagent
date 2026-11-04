import type { TaskPauseMethods } from "../manager/run-pause"
import type { AdmissionBarrier, ResumeCredential } from "../pause/admission-barrier"
import type { TaskRecord } from "../state"
import type { CancelOptions, CancelOutcome } from "../steering/types"
import type { AckReason, AckState, GuidanceOutcome } from "./control-schema"

// What the owner side needs from the task manager holding a live handle; nothing here restores,
// respawns or cancels a record this manager does not hold (design 3.3).
export type ControlOwnerPort = Pick<TaskPauseMethods, "pauseTask" | "holdTaskInput" | "observeTaskHold" | "resumePausedTask"> & {
  readonly managerInstance: string
  readonly hostPid: number
  sessionId(): string | undefined
  holds(taskId: string): boolean
  load(taskId: string): TaskRecord | undefined
  ownsRecord(record: TaskRecord): boolean
  inAncestry(record: TaskRecord, parentSessionId: string): boolean
  cancelTask(taskId: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome>
  readonly barrier?: AdmissionBarrier
  // The rest of the owner's own resume transaction for its Stop's root: the held admissions of
  // that root and the controller's released bookkeeping. Absent outside the omo-senpi wiring.
  releaseRemoteStop?(input: {
    readonly parentSessionId: string
    readonly pauseSeq: number
    readonly resumeId: string
    readonly credential: ResumeCredential
  }): Promise<void>
}

export type ReconcileAnswer = {
  readonly state: AckState
  readonly reason?: AckReason
  readonly childSeq?: number
  readonly turnId?: string
  readonly guidance?: readonly { readonly inputId: string; readonly outcome: GuidanceOutcome }[]
  // The owner deletes a register it answered resumed, cancelled, or with a terminal refusal.
  readonly final: boolean
}

export type ReconcileResult =
  | { readonly kind: "answer"; readonly answer: ReconcileAnswer }
  | { readonly kind: "retry" }
  | { readonly kind: "unaddressed" }
  | { readonly kind: "release_own_stop"; readonly root: string; readonly ownSeq: number }
