import { log } from "../../shared"
import { getSystemReminderHeaderLines, type PendingParentWake } from "./parent-wake-dedupe"

// One greppable line per parent-wake lifecycle transition, so lost background-task
// notifications can be traced from queue to dispatch to abandonment after the fact.
// Grep for "[parent-wake-ledger]" in oh-my-opencode.log; "abandoned" events with
// lostReplyWake=true are reply-required wakes that died without ever producing a turn.
export type ParentWakeLedgerEvent =
  | "queued"
  | "merged"
  | "requeued"
  | "dispatched"
  | "dispatch-requeued"
  | "output-observed"
  | "no-output-requeue"
  | "abandoned"
  | "consumed-dropped"
  | "duplicate-suppressed"

const MAX_HEADERS_PER_ENTRY = 6
const MAX_TASK_IDS_PER_ENTRY = 8
const TASK_ID_PATTERN = /\b(?:bg|ses)_[A-Za-z0-9]+\b/g

let ledgerIdSequence = 0

export function nextParentWakeLedgerId(): string {
  ledgerIdSequence += 1
  return `wake-${Date.now().toString(36)}-${ledgerIdSequence.toString(36)}`
}

export function extractNotificationHeaders(notifications: readonly string[]): string[] {
  const headers = new Set<string>()
  for (const notification of notifications) {
    for (const header of getSystemReminderHeaderLines(notification)) {
      headers.add(header)
      if (headers.size >= MAX_HEADERS_PER_ENTRY) {
        return [...headers]
      }
    }
  }
  return [...headers]
}

export function extractNotificationTaskIds(notifications: readonly string[]): string[] {
  const taskIds = new Set<string>()
  for (const notification of notifications) {
    for (const match of notification.matchAll(TASK_ID_PATTERN)) {
      taskIds.add(match[0])
      if (taskIds.size >= MAX_TASK_IDS_PER_ENTRY) {
        return [...taskIds]
      }
    }
  }
  return [...taskIds]
}

export function summarizeParentWakeForLedger(wake: PendingParentWake): Record<string, unknown> {
  return {
    wakeId: wake.ledgerId ?? "unassigned",
    shouldReply: wake.shouldReply,
    notificationCount: wake.notifications.length,
    headers: extractNotificationHeaders(wake.notifications),
    taskIds: extractNotificationTaskIds(wake.notifications),
    ...(wake.queuedAt !== undefined ? { queuedAt: wake.queuedAt } : {}),
    ...(wake.dispatchedAt !== undefined ? { dispatchedAt: wake.dispatchedAt } : {}),
    ...(wake.noReplyAdmittedAt !== undefined ? { noReplyAdmittedAt: wake.noReplyAdmittedAt } : {}),
    ...(wake.noAssistantOutputRetryCount !== undefined
      ? { noOutputRetries: wake.noAssistantOutputRetryCount }
      : {}),
  }
}

export function logParentWakeLedger(
  event: ParentWakeLedgerEvent,
  sessionID: string,
  wake?: PendingParentWake,
  extra?: Record<string, unknown>,
): void {
  log(`[parent-wake-ledger] ${event}:`, {
    sessionID,
    ...(wake ? summarizeParentWakeForLedger(wake) : {}),
    ...extra,
  })
}
