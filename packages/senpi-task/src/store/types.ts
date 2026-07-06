import type { TaskRecord, TaskTransition, TaskTransitionResult } from "../state"

export type StateDirConfig = {
  readonly project_dir: string
  readonly task?: {
    readonly state_dir?: string
  }
}

export type TaskRecordDiagnostic = {
  readonly type: "parse_error"
  readonly path: string
  readonly message: string
}

export type ListTaskRecordsResult = {
  readonly records: readonly TaskRecord[]
  readonly diagnostics: readonly TaskRecordDiagnostic[]
}

export type PersistedTaskEvent = {
  readonly type: string
  readonly payload: unknown
}

export type TaskRecordStore = {
  readonly stateDir: string
  readonly save: (record: TaskRecord) => void
  // Manager-owned overwrite for bookkeeping that lives OUTSIDE the status transition table (revive
  // epoch bump, notification epoch persistence). Normal status changes must use transition().
  readonly replace: (record: TaskRecord) => void
  readonly load: (taskId: string) => TaskRecord | null
  readonly list: () => ListTaskRecordsResult
  readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string
  readonly transition: (taskId: string, transition: TaskTransition) => TaskTransitionResult
  // TTL cleanup only (lifecycle-owned): drop a record and its JSONL log. Idempotent on a missing
  // record. Normal terminal transitions must NEVER delete a record - they use transition().
  readonly remove: (taskId: string) => void
}
