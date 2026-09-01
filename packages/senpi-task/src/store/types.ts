import type { TaskRecord, TaskTransition, TaskTransitionResult } from "../state"

export type StateDirConfig = {
  readonly project_dir: string
  readonly task?: {
    readonly state_dir?: string
  }
}

export type TaskRecordDiagnostic =
  | {
      readonly type: "parse_error"
      readonly path: string
      readonly message: string
    }
  | {
      readonly type: "parse_warning"
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

// The outcome of the atomic conditional tombstone (phase 1 of a TTL expunge). "tombstoned"
// carries the committed record as re-read under the lock so the caller can bookkeep orphan pids
// from authoritative data; "retained" means the fresh record matched the retention predicate;
// "missing" means the record vanished before the lock section ran.
export type TombstoneResult =
  | { readonly kind: "tombstoned"; readonly record: TaskRecord }
  | { readonly kind: "retained" }
  | { readonly kind: "missing" }

export type TaskRecordStore = {
  readonly stateDir: string
  readonly save: (record: TaskRecord) => void
  // Manager-owned overwrite for bookkeeping that lives OUTSIDE the status transition table (revive
  // epoch bump, notification epoch persistence). Normal status changes must use transition().
  readonly replace: (record: TaskRecord) => void
  // Serialized read-modify-write over the freshest on-disk record. Returning the input record skips
  // the write; callers use this for narrow conditional patches that must not clobber lifecycle state.
  readonly mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord) => TaskRecord | null
  readonly load: (taskId: string) => TaskRecord | null
  readonly list: () => ListTaskRecordsResult
  readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string
  readonly transition: (taskId: string, transition: TaskTransition) => TaskTransitionResult
  // Lifecycle-owned cleanup (TTL, cancel, reconcile): delete EVERY durable task artifact for a
  // task - children/<taskId>/ recursively, the completion spill file, the event log, and the record
  // (record-last so a crash mid-cleanup never orphans a record pointing at nothing; a later sweep
  // retries). Idempotent: a re-run on a partially-cleaned task is a no-op. Normal terminal
  // transitions must NEVER delete a record - they use transition().
  readonly remove: (taskId: string) => void
  // TTL expunge, phase 1 (inside the record lock): re-read the freshest record and, ONLY when
  // shouldRetain(fresh) is false, atomically rename the record to <taskId>.json.expunging. The
  // tombstone makes the record invisible to load/list/mutate so no claim can take it. The locked
  // section does re-read + validate + rename ONLY - recursive filesystem deletion can outlive any
  // lease, so artifact removal is always phase 2 (completeExpunge), outside the lock.
  readonly tombstoneIfExpired: (
    taskId: string,
    shouldRetain: (record: TaskRecord) => boolean,
  ) => TombstoneResult
  // TTL expunge, phase 2 (outside the lock) AND crash recovery for interrupted sweeps: delete the
  // children dir, spill file, and event log, then drop the tombstone. A tombstoned record is
  // already committed to deletion and is never resurrected, so completion is idempotent and needs
  // no lock.
  readonly completeExpunge: (taskId: string) => void
  // Task ids with a leftover <taskId>.json.expunging tombstone from a sweep that crashed between
  // the phases. Every TTL sweep completes phase 2 for these before doing anything else.
  readonly listExpunging: () => readonly string[]
}
