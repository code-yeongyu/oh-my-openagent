import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import type { TaskRecord, TaskStatus, TaskTransition, TaskTransitionResult } from "../state"
import { isSpawnSpecV1 } from "../state"
import type { TaskRecordStore } from "../store"

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])
const STATUS_CHANGING: ReadonlySet<TaskTransition["type"]> = new Set([
  "start",
  "complete",
  "fail",
  "cancel",
  "interrupt",
  "lose",
])

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.has(status)
}

// One recorded breach of invariant 1 (exactly-once) or invariant 2 (terminal idempotence) seen at
// the store seam, carrying enough context to name the offending record.
export type StoreBreach = {
  readonly invariant: 1 | 2
  readonly detail: string
}

export type StoreObservations = {
  // `${taskId}:${epoch}` -> number of times a notification for that (task, epoch) was persisted.
  readonly notifyCommits: Map<string, number>
  // `${taskId}:${epoch}` -> number of times that (task, epoch) was actually enqueued to the parent.
  readonly enqueueByEpoch: Map<string, number>
  readonly breaches: StoreBreach[]
  readonly lifecycleBreaches: string[]
  readonly maxResidentsByParent: Map<string, number>
  readonly forbiddenResidency: Set<string>
}

export type ObservingStore = {
  readonly store: TaskRecordStore
  readonly observations: StoreObservations
}

// Wrap a real store so notification persistence (invariant 1) and every status write (invariant 2)
// are observed without changing behaviour: each method delegates straight to the backing store.
export function createObservingStore(backing: TaskRecordStore, shared?: StoreObservations): ObservingStore {
  const observations: StoreObservations = shared ?? {
    notifyCommits: new Map(),
    enqueueByEpoch: new Map(),
    breaches: [],
    lifecycleBreaches: [],
    maxResidentsByParent: new Map(),
    forbiddenResidency: new Set(),
  }

  const observeWrite = (before: TaskRecord | null, after: TaskRecord | null): void => {
    if (after !== null) observeLifecycleWrite(backing, observations, before, after)
    observeResidentCounts(backing, observations)
  }
  const store: TaskRecordStore = {
    stateDir: backing.stateDir,
    save: (record) => {
      const before = backing.load(record.task_id)
      backing.save(record)
      observeWrite(before, backing.load(record.task_id))
    },
    mutate: (taskId, mutation) => {
      const before = backing.load(taskId)
      const result = backing.mutate(taskId, mutation)
      observeWrite(before, backing.load(taskId))
      return result
    },
    load: (taskId) => backing.load(taskId),
    list: () => backing.list(),
    appendEvent: (taskId, event) => backing.appendEvent(taskId, event),
    remove: async (taskId) => {
      await backing.remove(taskId)
      observeResidentCounts(backing, observations)
    },
    tombstoneIfExpired: (taskId, shouldRetain) => backing.tombstoneIfExpired(taskId, shouldRetain),
    completeExpunge: (taskId) => backing.completeExpunge(taskId),
    listExpunging: () => backing.listExpunging(),
    replace: (record) => {
      const before = backing.load(record.task_id)
      observeReplace(backing, observations, record)
      backing.replace(record)
      observeWrite(before, backing.load(record.task_id))
    },
    transition: (taskId, transition) => {
      const before = backing.load(taskId)
      const result = backing.transition(taskId, transition)
      observeTransition(observations, transition, before, result)
      observeWrite(before, backing.load(taskId))
      return result
    },
  }

  return { store, observations }
}

function observeReplace(backing: TaskRecordStore, observations: StoreObservations, record: TaskRecord): void {
  const previous = backing.load(record.task_id)
  if (previous === null) return
  const nextNotified = record.notification.notified_epoch
  if (nextNotified > previous.notification.notified_epoch) {
    const key = `${record.task_id}:${nextNotified}`
    observations.notifyCommits.set(key, (observations.notifyCommits.get(key) ?? 0) + 1)
  }
  if (
    isTerminalStatus(previous.status) &&
    record.status !== previous.status &&
    record.notification.run_epoch <= previous.notification.run_epoch
  ) {
    observations.breaches.push({
      invariant: 2,
      detail: `replace overwrote terminal ${previous.status} -> ${record.status} for ${record.task_id} at epoch ${record.notification.run_epoch}`,
    })
  }
}

function observeLifecycleWrite(
  backing: TaskRecordStore,
  observations: StoreObservations,
  before: TaskRecord | null,
  after: TaskRecord,
): void {
  if (before !== null) {
    if (after.notification.run_epoch < before.notification.run_epoch) {
      observations.lifecycleBreaches.push(`run_epoch regressed for ${after.task_id}: ${before.notification.run_epoch} -> ${after.notification.run_epoch}`)
    }
    const becameSuspended = after.residency_state === "persisted_only" || after.residency_state === "rpc_detached"
    if (becameSuspended && after.notification.run_epoch !== before.notification.run_epoch) {
      observations.lifecycleBreaches.push(`suspension changed run_epoch for ${after.task_id}: ${before.notification.run_epoch} -> ${after.notification.run_epoch}`)
    }
  }
  if (after.status === "lost" && hasRecoveryArtifact(backing, after)) {
    observations.lifecycleBreaches.push(`recoverable task ${after.task_id} transitioned to lost`)
  }
  if (after.killed === true || after.status === "cancelled" || after.residency_state === "evicted" || after.residency_state === "disposed") {
    observations.forbiddenResidency.add(after.task_id)
  } else if (after.residency_state === "resident" && observations.forbiddenResidency.has(after.task_id)) {
    observations.lifecycleBreaches.push(`deliberately stopped task ${after.task_id} regained residency`)
  }
}

function hasRecoveryArtifact(backing: TaskRecordStore, record: TaskRecord): boolean {
  if (record.spawn_spec !== undefined && isSpawnSpecV1(record.spawn_spec)) return true
  const sessions = join(backing.stateDir, "children", record.task_id, "sessions")
  if (!existsSync(sessions)) return false
  return readdirSync(sessions).some((entry) => entry.endsWith(".jsonl"))
}

function observeResidentCounts(backing: TaskRecordStore, observations: StoreObservations): void {
  const counts = new Map<string, number>()
  for (const record of backing.list().records) {
    if (record.residency_state !== "resident") continue
    counts.set(record.parent_session_id, (counts.get(record.parent_session_id) ?? 0) + 1)
  }
  for (const [parent, count] of counts) {
    observations.maxResidentsByParent.set(parent, Math.max(count, observations.maxResidentsByParent.get(parent) ?? 0))
  }
}

function observeTransition(
  observations: StoreObservations,
  transition: TaskTransition,
  before: TaskRecord | null,
  result: TaskTransitionResult,
): void {
  if (before === null || !isTerminalStatus(before.status) || !STATUS_CHANGING.has(transition.type)) return
  // A status-changing transition landing on an already-terminal record must be rejected AND logged
  // as a late transition (not silently dropped, not applied).
  if (result.applied || result.audit.type !== "late_transition_ignored") {
    observations.breaches.push({
      invariant: 2,
      detail: `late ${transition.type} on terminal ${before.status} for ${before.task_id} was ${result.applied ? "applied" : "not logged as late"} (audit=${result.audit.type})`,
    })
  }
}
