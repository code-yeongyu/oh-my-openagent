import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { ResumeCredential } from "../pause/admission-barrier"
import type { WorkpoolAgent, WorkpoolCaller, WorkpoolEvent, WorkpoolItem, WorkpoolRecord, WorkpoolSpec, WorkpoolWorker } from "./types"

export type WorkpoolRequest = {
  readonly resumeCredential?: ResumeCredential
  readonly pool: WorkpoolRecord
  readonly item: WorkpoolItem
  readonly worker?: WorkpoolWorker
  current(): boolean
  authorize(): void
  bind(taskId: string, epoch: number): boolean
  event(event: WorkpoolEvent): void
}
export type WorkpoolAdmission = {
  readonly tasks: TaskRecordStore
  resolve(caller: WorkpoolCaller, agent: WorkpoolAgent): WorkpoolSpec
  hasFreeSlot(model: string): boolean
  request(input: WorkpoolRequest): { readonly kind?: "held"; readonly pauseSeq?: number; cancel(): void }
  deliveryHeld?(rootSessionId: string): boolean
  drain(): void
  get(taskId: string): TaskRecord | undefined
  pending(taskId: string): boolean
  cancel(taskId: string): Promise<unknown>
  waitFor(taskId: string, signal: AbortSignal): Promise<TaskRecord>
}
