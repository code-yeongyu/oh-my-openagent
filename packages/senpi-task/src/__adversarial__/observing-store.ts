import type { TaskRecord, TaskStatus, TaskTransition, TaskTransitionResult } from "../state"
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
}

export type ObservingStore = {
  readonly store: TaskRecordStore
  readonly observations: StoreObservations
}

// Wrap a real store so notification persistence (invariant 1) and every status write (invariant 2)
// are observed without changing behaviour: each method delegates straight to the backing store.
export function createObservingStore(backing: TaskRecordStore): ObservingStore {
  const observations: StoreObservations = { notifyCommits: new Map(), enqueueByEpoch: new Map(), breaches: [] }

  const store: TaskRecordStore = {
    stateDir: backing.stateDir,
    save: (record) => backing.save(record),
    load: (taskId) => backing.load(taskId),
    list: () => backing.list(),
    appendEvent: (taskId, event) => backing.appendEvent(taskId, event),
    remove: (taskId) => backing.remove(taskId),
    replace: (record) => {
      observeReplace(backing, observations, record)
      backing.replace(record)
    },
    transition: (taskId, transition) => {
      const before = backing.load(taskId)
      const result = backing.transition(taskId, transition)
      observeTransition(observations, transition, before, result)
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
