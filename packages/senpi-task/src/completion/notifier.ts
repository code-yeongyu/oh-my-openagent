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
  RoutingDecision,
} from "./types"

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "error", "cancelled", "interrupted", "lost"])

type BufferedEntry = {
  readonly task_id: string
  readonly epoch: number
  readonly details: CompletionDetails
}

export function createCompletionNotifier(deps: CompletionNotifierDeps): CompletionNotifier {
  const buffered = new Map<string, BufferedEntry[]>()

  function notifyTerminal(request: CompletionRequest): NotifyResult {
    if (!request.runInBackground) return { kind: "skipped", reason: "sync-task" }
    const record = deps.store.load(request.record.task_id) ?? request.record
    if (!TERMINAL_STATUSES.has(record.status)) return { kind: "skipped", reason: "not-terminal" }
    if (!shouldNotifyStatus(record.status)) return { kind: "skipped", reason: "non-notifying-terminal" }

    const epoch = record.notification.run_epoch
    if (record.notification.notified_epoch >= epoch) return { kind: "skipped", reason: "already-notified" }

    const details = buildCompletionDetails(record, request.tokens === undefined ? {} : { tokens: request.tokens })
    const decision = routeCompletion(request.parentState, deps.config)
    if (decision.kind === "buffer") {
      pushBuffered(buffered, record.parent_session_id, { task_id: record.task_id, epoch, details })
      return { kind: "buffered", reason: decision.reason }
    }

    const message = buildDeliveryMessage([details], decision)
    const delivered = deliverWithRetry(deps.notifier, message)
    if (delivered.ok) {
      persistNotified(deps.store, record, epoch)
      return { kind: "delivered", decision: deliveredDecision(decision) }
    }
    recordFailure(deps.store, record, epoch, delivered.error)
    return { kind: "failed" }
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

  return { notifyTerminal, flushBuffered, bufferedCount }
}

function buildDeliveryMessage(details: readonly CompletionDetails[], decision: RoutingDecision): ParentNotifierMessage {
  const base = buildCompletionMessage(details)
  if (decision.kind === "wake") return { ...base, triggerTurn: true }
  if (decision.kind === "deliver_streaming") return { ...base, deliverAs: decision.deliverAs }
  return base
}

function deliveredDecision(decision: RoutingDecision): DeliveredDecision {
  if (decision.kind === "wake") return "wake"
  if (decision.kind === "deliver_streaming") return "deliver_streaming"
  return "queue_silently"
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

function pushBuffered(buffered: Map<string, BufferedEntry[]>, sessionId: string, entry: BufferedEntry): void {
  const existing = buffered.get(sessionId) ?? []
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
