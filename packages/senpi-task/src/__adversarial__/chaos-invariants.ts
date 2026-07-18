import type { CompletionDetails, CompletionNotifier, ParentNotifier, ParentNotifierMessage } from "../completion"
import type { TaskRecordStore } from "../store"
import type { ChaosState } from "./chaos-actions"
import { isTerminalStatus } from "./observing-store"
import type { StoreObservations } from "./observing-store"

export type ChaosNotifier = ParentNotifier & {
  readonly calls: ParentNotifierMessage[]
  failNext(count: number): void
}

export type NotificationEpochTracker = {
  readonly activeByTask: Map<string, number>
  readonly bufferedByTask: Map<string, number[]>
  readonly detailEpochs: WeakMap<CompletionDetails, number>
}

export function createNotificationEpochTracker(): NotificationEpochTracker {
  return { activeByTask: new Map(), bufferedByTask: new Map(), detailEpochs: new WeakMap() }
}

function rememberBufferedEpoch(tracker: NotificationEpochTracker, taskId: string, epoch: number): void {
  const epochs = tracker.bufferedByTask.get(taskId) ?? []
  if (!epochs.includes(epoch)) epochs.push(epoch)
  tracker.bufferedByTask.set(taskId, epochs)
}

function resolveDetailEpoch(tracker: NotificationEpochTracker, store: TaskRecordStore, detail: CompletionDetails): number {
  const tagged = tracker.detailEpochs.get(detail)
  if (tagged !== undefined) return tagged
  const active = tracker.activeByTask.get(detail.task_id)
  if (active !== undefined) {
    tracker.detailEpochs.set(detail, active)
    return active
  }
  const buffered = tracker.bufferedByTask.get(detail.task_id)
  const bufferedEpoch = buffered?.shift()
  if (buffered?.length === 0) tracker.bufferedByTask.delete(detail.task_id)
  const epoch = bufferedEpoch ?? store.load(detail.task_id)?.notification.run_epoch ?? 0
  tracker.detailEpochs.set(detail, epoch)
  return epoch
}

export function createChaosNotifier(
  store: TaskRecordStore,
  observations: StoreObservations,
  epochs: NotificationEpochTracker,
): ChaosNotifier {
  const calls: ParentNotifierMessage[] = []
  let remainingFailures = 0
  return {
    calls,
    failNext(count) {
      remainingFailures = count
    },
    enqueue(message) {
      const tagged = message.details.map((detail) => ({ detail, epoch: resolveDetailEpoch(epochs, store, detail) }))
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error("chaos parent gone")
      }
      calls.push(message)
      for (const entry of tagged) {
        const key = `${entry.detail.task_id}:${entry.epoch}`
        observations.enqueueByEpoch.set(key, (observations.enqueueByEpoch.get(key) ?? 0) + 1)
      }
    },
  }
}

export function instrumentCompletionNotifier(
  notifier: CompletionNotifier,
  store: TaskRecordStore,
  epochs: NotificationEpochTracker,
): CompletionNotifier {
  return {
    notifyTerminal(request) {
      const taskId = request.record.task_id
      epochs.activeByTask.set(taskId, request.record.notification.run_epoch)
      try {
        const result = notifier.notifyTerminal(request)
        if (result.kind === "buffered") rememberBufferedEpoch(epochs, taskId, request.record.notification.run_epoch)
        return result
      } finally {
        epochs.activeByTask.delete(taskId)
      }
    },
    flushBuffered(input) {
      try {
        return notifier.flushBuffered(input)
      } finally {
        epochs.bufferedByTask.clear()
      }
    },
    reconcileFailedNotifications(input) {
      const records = store.list().records
      for (const record of records) epochs.activeByTask.set(record.task_id, record.notification.run_epoch)
      try {
        notifier.reconcileFailedNotifications(input)
      } finally {
        for (const record of records) epochs.activeByTask.delete(record.task_id)
      }
    },
    bufferedCount: (sessionId) => notifier.bufferedCount(sessionId),
  }
}

export type InvariantId = 1 | 2 | 3 | 4 | 5

export type Violation = {
  readonly invariant: InvariantId
  readonly detail: string
}

// Invariant 1: exactly-once notification per (task_id, run_epoch). Two independent witnesses: the
// persisted notified_epoch never advances twice for one epoch, and every notify/flush result maps
// to exactly the enqueue count it claims.
function checkExactlyOnce(state: ChaosState): Violation[] {
  const violations: Violation[] = []
  for (const [key, count] of state.harness.observations.enqueueByEpoch) {
    if (count > 1) violations.push({ invariant: 1, detail: `parent enqueued ${count} times for (task:epoch) ${key}` })
  }
  for (const [key, count] of state.harness.observations.notifyCommits) {
    if (count > 1) violations.push({ invariant: 1, detail: `notification persisted ${count} times for ${key}` })
  }
  for (const breach of state.seamBreaches) violations.push({ invariant: 1, detail: breach })
  return violations
}

// Invariant 2: terminal idempotence. The observing store records any late status transition that
// was applied (or not logged) and any replace that overwrote a terminal without a fresh epoch.
function checkTerminalIdempotence(state: ChaosState): Violation[] {
  return state.harness.observations.breaches
    .filter((breach) => breach.invariant === 2)
    .map((breach) => ({ invariant: 2 as const, detail: breach.detail }))
}

// Invariant 3: no concurrency slot leak. After draining every task to terminal the queue must be
// empty and every slot released, proven by starting a fresh full batch that must all run.
async function checkNoSlotLeak(state: ChaosState): Promise<Violation[]> {
  const violations: Violation[] = []
  const records = state.harness.store.list().records
  const pending = records.filter((record) => record.status === "pending")
  if (pending.length > 0) violations.push({ invariant: 3, detail: `${pending.length} task(s) still pending after drain` })
  const stuck = records.filter((record) => !isTerminalStatus(record.status))
  if (stuck.length > 0) violations.push({ invariant: 3, detail: `${stuck.length} non-terminal task(s) after drain` })

  const probeIds: string[] = []
  let queued = 0
  for (let index = 0; index < state.harness.limit; index += 1) {
    const result = await state.harness.manager.start({
      prompt: "slot probe",
      parent_session_id: state.harness.sessionId,
      root_session_id: state.harness.sessionId,
      depth: 1,
      category: "quick",
      model: state.harness.model,
    })
    if (result.kind !== "started") continue
    probeIds.push(result.task_id)
    if (result.status !== "running") queued += 1
  }
  if (queued > 0) {
    violations.push({ invariant: 3, detail: `slot leak: ${queued}/${state.harness.limit} probe task(s) queued despite all prior tasks terminal` })
  }
  for (const id of probeIds) state.harness.runner.handles.get(id)?.settle({ status: "completed", finalResponse: "probe" })
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  return violations
}

// Invariant 5: every instrumented waitFor call settles by quiescence, and a task whose persisted
// cancel event says previous_status=pending never crosses the runner start boundary.
function checkWaitersAndPendingCancellation(state: ChaosState): Violation[] {
  const violations: Violation[] = []
  const { registrations, settlements } = state.harness.waiters
  if (settlements !== registrations) {
    violations.push({ invariant: 5, detail: `waitFor settled ${settlements}/${registrations} registered waiter(s)` })
  }
  const started = new Set(state.harness.runner.startedTaskIds)
  for (const taskId of state.harness.pendingCancelledTaskIds) {
    if (started.has(taskId)) {
      violations.push({ invariant: 5, detail: `task ${taskId} cancelled from pending reached runner start` })
    }
  }
  return violations
}

export async function collectInvariantViolations(state: ChaosState): Promise<Violation[]> {
  return [
    ...checkExactlyOnce(state),
    ...checkTerminalIdempotence(state),
    ...(await checkNoSlotLeak(state)),
    ...checkWaitersAndPendingCancellation(state),
  ]
}
