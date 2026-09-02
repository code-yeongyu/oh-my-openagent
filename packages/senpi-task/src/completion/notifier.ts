import type { TaskRecord, TaskStatus } from "../state"
import { attemptDeliveryWithSyncRetry, type DeliveryAttempt } from "./delivery-attempt"
import { buildCompletionDetails, buildCompletionMessage } from "./notification"
import { persistNotified, recordNotificationDrop, recordNotificationFailure } from "./notification-ledger"
import { routeCompletion, shouldNotifyStatus } from "./routing"
import type {
  CompletionDetails,
  CompletionNotifier,
  CompletionNotifierDeps,
  CompletionRequest,
  DeliveredDecision,
  FlushInput,
  FlushResult,
  NotifyResult,
  ParentNotifierMessage,
  ParentState,
  ReconcileUnnotifiedNotificationsInput,
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

type DeliveryIdentity = Pick<BufferedEntry, "task_id" | "epoch">

export function createCompletionNotifier(deps: CompletionNotifierDeps): CompletionNotifier {
  const buffered = new Map<string, BufferedEntry[]>()
  const inFlight = new Map<string, DeliveredDecision>()
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

  function observePendingDelivery(
    entries: readonly BufferedEntry[],
    decision: DeliveredDecision,
    receipt: Promise<void>,
    recordFailure: boolean,
  ): void {
    for (const entry of entries) inFlight.set(retryKey(entry), decision)
    void receipt.then(
      () => {
        for (const entry of entries) {
          inFlight.delete(retryKey(entry))
          finishRetryChain(entry)
          persistNotified(deps.store, entry.task_id, entry.epoch)
        }
      },
      (error) => {
        for (const entry of entries) {
          inFlight.delete(retryKey(entry))
          if (deps.store.load(entry.task_id) === null) {
            finishRetryChain(entry)
            continue
          }
          if (recordFailure) recordNotificationFailure(deps.store, entry.task_id, entry.epoch, error)
          scheduleRetry(entry)
        }
      },
    )
  }

  function applyDeliveryAttempt(
    entries: readonly BufferedEntry[],
    decision: DeliveredDecision,
    attempt: DeliveryAttempt,
    recordFailure: boolean,
  ): boolean {
    switch (attempt.kind) {
      case "acknowledged":
        for (const entry of entries) {
          finishRetryChain(entry)
          persistNotified(deps.store, entry.task_id, entry.epoch)
        }
        return true
      case "pending":
        observePendingDelivery(entries, decision, attempt.receipt, recordFailure)
        return true
      case "rejected":
        for (const entry of entries) {
          if (recordFailure) recordNotificationFailure(deps.store, entry.task_id, entry.epoch, attempt.error)
          scheduleRetry(entry)
        }
        return false
      default:
        return assertNever(attempt)
    }
  }

  function runScheduledRetry(entry: BufferedEntry): void {
    const fresh = deps.store.load(entry.task_id)
    if (fresh === null) return finishRetryChain(entry)
    if (fresh.notification.run_epoch !== entry.epoch) return finishRetryChain(entry)
    if (!TERMINAL_STATUSES.has(fresh.status)) return finishRetryChain(entry)
    if (!shouldNotifyStatus(fresh.status)) return finishRetryChain(entry)
    if (fresh.notification.notified_epoch >= entry.epoch) return finishRetryChain(entry)
    if (inFlight.has(retryKey(entry))) return

    const decision = routeCompletion(getParentState())
    if (fresh.parent_session_id !== getCurrentSessionId()) return finishRetryChain(entry)
    if (decision.kind === "buffer") {
      pushBuffered(buffered, fresh.parent_session_id, entry)
      finishRetryChain(entry)
      return
    }

    const attempt = attemptDeliveryWithSyncRetry(deps.notifier, buildDeliveryMessage([entry.details], decision))
    applyDeliveryAttempt([entry], deliveredDecision(decision), attempt, false)
  }

  function deliverRecord(record: TaskRecord, details: CompletionDetails, parentState: ParentState): NotifyResult {
    const entry = { task_id: record.task_id, epoch: record.notification.run_epoch, details }
    const activeDecision = inFlight.get(retryKey(entry))
    if (activeDecision !== undefined) return { kind: "delivered", decision: activeDecision }
    const decision = routeCompletion(parentState)
    if (decision.kind === "buffer") {
      pushBuffered(buffered, record.parent_session_id, entry)
      return { kind: "buffered", reason: decision.reason }
    }

    const resolvedDecision = deliveredDecision(decision)
    const attempt = attemptDeliveryWithSyncRetry(deps.notifier, buildDeliveryMessage([details], decision))
    return applyDeliveryAttempt([entry], resolvedDecision, attempt, true)
      ? { kind: "delivered", decision: resolvedDecision }
      : { kind: "failed" }
  }

  function notifyTerminal(request: CompletionRequest): NotifyResult {
    if (!request.runInBackground) return { kind: "skipped", reason: "sync-task" }
    const record = deps.store.load(request.record.task_id) ?? request.record
    if (!TERMINAL_STATUSES.has(record.status)) return { kind: "skipped", reason: "not-terminal" }
    if (!shouldNotifyStatus(record.status)) return { kind: "skipped", reason: "non-notifying-terminal" }

    if (record.notification.notified_epoch >= record.notification.run_epoch) {
      return { kind: "skipped", reason: "already-notified" }
    }

    const details = buildDetails(record, request.tokens)
    return deliverRecord(record, details, request.parentState)
  }

  function flushBuffered(input: FlushInput): FlushResult {
    const entries = buffered.get(input.sessionId)
    if (entries === undefined || entries.length === 0) return { kind: "empty" }
    buffered.delete(input.sessionId)

    if (input.replaced) {
      for (const entry of entries) recordNotificationDrop(deps.store, entry.task_id, entry.epoch)
      return { kind: "dropped", count: entries.length }
    }

    const message: ParentNotifierMessage = {
      ...buildCompletionMessage(entries.map((entry) => entry.details)),
      triggerTurn: true,
    }
    const attempt = attemptDeliveryWithSyncRetry(deps.notifier, message)
    return applyDeliveryAttempt(entries, "wake", attempt, true)
      ? { kind: "flushed", count: entries.length }
      : { kind: "failed", count: entries.length }
  }

  function bufferedCount(sessionId: string): number {
    return buffered.get(sessionId)?.length ?? 0
  }

  // Crash recovery: the in-memory buffer dies with the process, so on session start every
  // terminal child of THIS session that still owes a notification goes through the normal
  // delivery path (dedupe identity stays (task_id, run_epoch)). Two populations owe one:
  // (a) notify_on_terminal records whose latest run_epoch was never recorded notified, and
  // (b) legacy pre-upgrade records with an in-flight failed delivery (notification_failed_epoch
  // set) so their retries survive the upgrade.
  function reconcileUnnotifiedNotifications(input: ReconcileUnnotifiedNotificationsInput): void {
    const listed = deps.store.list()
    for (const record of listed.records) {
      const epoch = record.notification.run_epoch
      if (record.parent_session_id !== input.sessionId) continue
      if (record.notification.notified_epoch >= epoch) continue
      if (!TERMINAL_STATUSES.has(record.status)) continue
      if (!shouldNotifyStatus(record.status)) continue
      if (!owesNotification(record)) continue
      // A LIVE in-memory buffered entry already owns delivery of this (task_id, run_epoch) - the
      // next flush delivers it. Reconcile only recovers notifications whose buffer died with the
      // process; delivering here too would double-notify (chaos inv1).
      if (hasBuffered(buffered, record.parent_session_id, record.task_id, epoch)) continue
      if (inFlight.has(retryKey({ task_id: record.task_id, epoch }))) continue
      deliverRecord(record, buildDetails(record), input.parentState)
    }
  }

  function owesNotification(record: TaskRecord): boolean {
    return record.notify_on_terminal || record.notification.notification_failed_epoch !== undefined
  }

  function buildDetails(record: TaskRecord, tokens?: number): CompletionDetails {
    return buildCompletionDetails(record, {
      ...(tokens === undefined ? {} : { tokens }),
      ...(deps.stateDir === undefined ? {} : { stateDir: deps.stateDir }),
    })
  }

  return {
    notifyTerminal,
    flushBuffered,
    reconcileUnnotifiedNotifications,
    reconcileFailedNotifications: reconcileUnnotifiedNotifications,
    bufferedCount,
  }
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

function retryKey(entry: DeliveryIdentity): string {
  return `${entry.task_id}:${entry.epoch}`
}

function hasBuffered(buffered: Map<string, BufferedEntry[]>, sessionId: string, taskId: string, epoch: number): boolean {
  return (buffered.get(sessionId) ?? []).some((entry) => entry.task_id === taskId && entry.epoch === epoch)
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

function assertNever(value: never): never {
  throw new Error(`Unhandled delivery attempt: ${JSON.stringify(value)}`)
}
