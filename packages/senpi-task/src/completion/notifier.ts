import { log } from "@oh-my-opencode/utils"

import type { TaskRecord, TaskStatus } from "../state"
import { buildCompletionDetails, buildCompletionMessage } from "./notification"
import { routeCompletion, shouldNotifyStatus } from "./routing"
import type {
  CompletionDetails,
  CompletionNotifier,
  CompletionNotifierDeps,
  CompletionNotifierStore,
  CompletionRequest,
  DeliveredDecision,
  FlushInput,
  FlushResult,
  NotifyResult,
  ParentNotifier,
  ParentNotifierMessage,
  ParentState,
  ReconcileFailedNotificationsInput,
  RoutingDecision,
} from "./types"

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "error", "cancelled", "interrupted", "lost"])
const MAX_SCHEDULED_RETRIES = 8
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 30_000
const RETRY_JITTER_MS = 200

type BufferedEntry = {
  readonly task_id: string
  readonly epoch: number
  readonly details: CompletionDetails
}

export function createCompletionNotifier(deps: CompletionNotifierDeps): CompletionNotifier {
  const buffered = new Map<string, BufferedEntry[]>()
  const scheduledRetries = new Map<string, () => void>()
  const scheduledRetryCounts = new Map<string, number>()
  const schedule = deps.schedule ?? defaultSchedule
  const getParentState = deps.getParentState ?? (() => ({ kind: "idle" }))
  const getCurrentSessionId = deps.getCurrentSessionId ?? (() => undefined)

  function finishRetryChain(entry: BufferedEntry): void {
    const key = retryKey(entry)
    const cancel = scheduledRetries.get(key)
    scheduledRetries.delete(key)
    scheduledRetryCounts.delete(key)
    cancel?.()
  }

  function scheduleRetry(entry: BufferedEntry): void {
    const key = retryKey(entry)
    if (scheduledRetries.has(key)) return
    const retryNumber = (scheduledRetryCounts.get(key) ?? 0) + 1
    if (retryNumber > MAX_SCHEDULED_RETRIES) {
      // Exhausted the backoff ladder: drop the retry state so it does not leak for the lifetime of
      // the process. A later reconcile or notifyTerminal for the same epoch will restart fresh.
      finishRetryChain(entry)
      return
    }
    scheduledRetryCounts.set(key, retryNumber)
    const cancel = schedule(() => {
      scheduledRetries.delete(key)
      runScheduledRetry(entry)
    }, retryDelay(retryNumber))
    scheduledRetries.set(key, cancel)
  }

  function runScheduledRetry(entry: BufferedEntry): void {
    const fresh = deps.store.load(entry.task_id)
    if (fresh === null) return finishRetryChain(entry)
    if (fresh.notification.run_epoch !== entry.epoch) return finishRetryChain(entry)
    if (!TERMINAL_STATUSES.has(fresh.status)) return finishRetryChain(entry)
    if (!shouldNotifyStatus(fresh.status)) return finishRetryChain(entry)
    if (fresh.notification.notified_epoch >= entry.epoch) return finishRetryChain(entry)

    const decision = routeCompletion(getParentState())
    if (fresh.parent_session_id !== getCurrentSessionId()) return finishRetryChain(entry)
    if (decision.kind === "buffer") {
      pushBuffered(buffered, fresh.parent_session_id, entry)
      finishRetryChain(entry)
      return
    }

    const delivered = deliverWithRetry(deps.notifier, buildDeliveryMessage([entry.details], decision))
    if (delivered.ok) {
      finishRetryChain(entry)
      persistNotified(deps.store, fresh, entry.epoch)
      return
    }
    scheduleRetry(entry)
  }

  function deliverRecord(record: TaskRecord, details: CompletionDetails, parentState: ParentState): NotifyResult {
    const entry = { task_id: record.task_id, epoch: record.notification.run_epoch, details }
    const decision = routeCompletion(parentState)
    if (decision.kind === "buffer") {
      pushBuffered(buffered, record.parent_session_id, entry)
      return { kind: "buffered", reason: decision.reason }
    }

    const delivered = deliverWithRetry(deps.notifier, buildDeliveryMessage([details], decision))
    if (delivered.ok) {
      finishRetryChain(entry)
      persistNotified(deps.store, record, entry.epoch)
      return { kind: "delivered", decision: deliveredDecision(decision) }
    }
    recordFailure(deps.store, record, entry.epoch, delivered.error)
    scheduleRetry(entry)
    return { kind: "failed" }
  }

  function notifyTerminal(request: CompletionRequest): NotifyResult {
    if (!request.runInBackground) return { kind: "skipped", reason: "sync-task" }
    const record = deps.store.load(request.record.task_id) ?? request.record
    if (!TERMINAL_STATUSES.has(record.status)) return { kind: "skipped", reason: "not-terminal" }
    if (!shouldNotifyStatus(record.status)) return { kind: "skipped", reason: "non-notifying-terminal" }

    if (record.notification.notified_epoch >= record.notification.run_epoch) {
      return { kind: "skipped", reason: "already-notified" }
    }

    const details = buildCompletionDetails(record, request.tokens === undefined ? {} : { tokens: request.tokens })
    return deliverRecord(record, details, request.parentState)
  }

  function flushBuffered(input: FlushInput): FlushResult {
    const entries = buffered.get(input.sessionId)
    if (entries === undefined || entries.length === 0) return { kind: "empty" }
    buffered.delete(input.sessionId)

    if (input.replaced) {
      for (const entry of entries) dropEntry(deps.store, entry)
      return { kind: "dropped", count: entries.length }
    }

    const message: ParentNotifierMessage = {
      ...buildCompletionMessage(entries.map((entry) => entry.details)),
      triggerTurn: true,
    }
    const delivered = deliverWithRetry(deps.notifier, message)
    if (!delivered.ok) {
      for (const entry of entries) recordEntryFailure(deps.store, entry, delivered.error)
      return { kind: "failed", count: entries.length }
    }
    for (const entry of entries) persistEntry(deps.store, entry)
    return { kind: "flushed", count: entries.length }
  }

  function bufferedCount(sessionId: string): number {
    return buffered.get(sessionId)?.length ?? 0
  }

  function reconcileFailedNotifications(input: ReconcileFailedNotificationsInput): void {
    const listed = deps.store.list()
    for (const record of listed.records) {
      const epoch = record.notification.run_epoch
      if (record.parent_session_id !== input.sessionId) continue
      if (record.notification.notification_failed_epoch !== epoch) continue
      if (record.notification.notified_epoch >= epoch) continue
      if (!TERMINAL_STATUSES.has(record.status)) continue
      if (!shouldNotifyStatus(record.status)) continue
      deliverRecord(record, buildCompletionDetails(record), input.parentState)
    }
  }

  return { notifyTerminal, flushBuffered, reconcileFailedNotifications, bufferedCount }
}

// Every delivered notification stamps triggerTurn:true; the omo-senpi adapter routes it through the
// idle-injection coordinator, which batches ALL ready notifications into ONE injection steered into
// the running turn at the next tool-call boundary (unconditional-steer contract).
function buildDeliveryMessage(
  details: readonly CompletionDetails[],
  decision: Exclude<RoutingDecision, { kind: "buffer" }>,
): ParentNotifierMessage {
  void decision
  const base = buildCompletionMessage(details)
  return { ...base, triggerTurn: true }
}

function deliveredDecision(decision: Exclude<RoutingDecision, { kind: "buffer" }>): DeliveredDecision {
  return decision.kind === "wake" ? "wake" : "deliver_streaming"
}

function defaultSchedule(fn: () => void, delayMs: number): () => void {
  const timer = setTimeout(fn, delayMs)
  timer.unref?.()
  return () => clearTimeout(timer)
}

function retryDelay(retryNumber: number): number {
  const exponent = Math.min(retryNumber - 1, 8)
  const backoffMs = RETRY_BASE_MS * 2 ** exponent
  const jitterMs = Math.floor(Math.random() * RETRY_JITTER_MS)
  return Math.min(RETRY_MAX_MS, backoffMs + jitterMs)
}

function retryKey(entry: BufferedEntry): string {
  return `${entry.task_id}:${entry.epoch}`
}

function deliverWithRetry(
  notifier: ParentNotifier,
  message: ParentNotifierMessage,
): { readonly ok: true } | { readonly ok: false; readonly error: unknown } {
  const first = tryEnqueue(notifier, message)
  if (first.ok) return first
  return tryEnqueue(notifier, message)
}

function tryEnqueue(
  notifier: ParentNotifier,
  message: ParentNotifierMessage,
): { readonly ok: true } | { readonly ok: false; readonly error: unknown } {
  try {
    notifier.enqueue(message)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

// W1-V F5: defense-in-depth dedupe. The notified_epoch guard only rejects ALREADY-PERSISTED
// notifications; a buffered entry is not persisted until flush, so two notifyTerminal calls for the
// same terminal (task_id, epoch) before a flush would otherwise buffer - and later deliver - twice.
function pushBuffered(buffered: Map<string, BufferedEntry[]>, sessionId: string, entry: BufferedEntry): void {
  const existing = buffered.get(sessionId) ?? []
  if (existing.some((buffered) => buffered.task_id === entry.task_id && buffered.epoch === entry.epoch)) return
  existing.push(entry)
  buffered.set(sessionId, existing)
}

function persistNotified(store: CompletionNotifierStore, record: TaskRecord, epoch: number): void {
  store.replace({ ...record, notification: { ...record.notification, notified_epoch: epoch } })
}

function recordFailure(store: CompletionNotifierStore, record: TaskRecord, epoch: number, error: unknown): void {
  store.appendEvent(record.task_id, { type: "notification_failed", payload: { epoch, error: String(error) } })
  store.replace({ ...record, notification: { ...record.notification, notification_failed_epoch: epoch } })
  log("senpi-task completion delivery failed", { taskId: record.task_id, epoch })
}

function persistEntry(store: CompletionNotifierStore, entry: BufferedEntry): void {
  const fresh = store.load(entry.task_id)
  if (fresh !== null) persistNotified(store, fresh, entry.epoch)
}

function recordEntryFailure(store: CompletionNotifierStore, entry: BufferedEntry, error: unknown): void {
  const fresh = store.load(entry.task_id)
  if (fresh !== null) recordFailure(store, fresh, entry.epoch, error)
}

function dropEntry(store: CompletionNotifierStore, entry: BufferedEntry): void {
  store.appendEvent(entry.task_id, { type: "notification_dropped", payload: { epoch: entry.epoch } })
  log("senpi-task completion dropped for replaced session", { taskId: entry.task_id, epoch: entry.epoch })
}
