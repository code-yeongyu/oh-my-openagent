import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { WorkpoolAgent, WorkpoolCaller, WorkpoolEvent, WorkpoolItem, WorkpoolRecord, WorkpoolSpec, WorkpoolWorker } from "./types"

export type WorkpoolRequest = {
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
  request(input: WorkpoolRequest): { cancel(): void }
  drain(): void
  get(taskId: string): TaskRecord | undefined
  pending(taskId: string): boolean
  cancel(taskId: string): Promise<unknown>
  waitFor(taskId: string, signal: AbortSignal): Promise<TaskRecord>
}
