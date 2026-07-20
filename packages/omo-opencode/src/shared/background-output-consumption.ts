import { getMessageCursor, restoreMessageCursor, type CursorState } from "./session-cursor"

type MessageConsumptionKey = `${string}:${string}`

const cursorSnapshotsByMessage = new Map<MessageConsumptionKey, Map<string, CursorState | undefined>>()

// Consumed-successful-task identity tracking. Separate from the cursor-snapshot map so undo
// restore semantics stay untouched. Scoped by message key (parentSessionID:parentMessageID)
// to mirror the cursor map granularity; each entry pairs a taskID and taskSessionID as one
// consumed unit so cleanup by either alias removes the whole identity.
type ConsumedTaskIdentityEntry = { taskID?: string; taskSessionID?: string }

const consumedTaskIdentitiesByMessage = new Map<
  MessageConsumptionKey,
  Map<string, ConsumedTaskIdentityEntry>
>()

function getMessageKey(sessionID: string, messageID: string): MessageConsumptionKey {
  return `${sessionID}:${messageID}`
}

function buildConsumedEntryKey(
  taskID: string | undefined,
  taskSessionID: string | undefined
): string {
  return `task:${taskID ?? ""}|ses:${taskSessionID ?? ""}`
}

export function recordBackgroundOutputConsumption(
  parentSessionID: string | undefined,
  parentMessageID: string | undefined,
  taskSessionID: string | undefined
): void {
  if (!parentSessionID || !parentMessageID || !taskSessionID) return

  const messageKey = getMessageKey(parentSessionID, parentMessageID)
  const existing = cursorSnapshotsByMessage.get(messageKey) ?? new Map<string, CursorState | undefined>()

  if (!cursorSnapshotsByMessage.has(messageKey)) {
    cursorSnapshotsByMessage.set(messageKey, existing)
  }

  if (existing.has(taskSessionID)) return
  existing.set(taskSessionID, getMessageCursor(taskSessionID))

  // Also record the consumed-success identity so wake-suppression queries
  // (isBackgroundTaskOutputConsumption) can see this consumption. The legacy
  // positional helper only snapshots the cursor; without this, any callsite
  // using it (and the Task 1 tests that drive it directly) would populate the
  // cursor map but leave the identity map empty, so suppression never triggers.
  recordBackgroundTaskOutputConsumption({
    parentSessionID,
    parentMessageID,
    taskID: undefined,
    taskSessionID,
  })
}

export function recordBackgroundTaskOutputConsumption(args: {
  parentSessionID: string | undefined
  parentMessageID: string | undefined
  taskID: string | undefined
  taskSessionID: string | undefined
}): void {
  const { parentSessionID, parentMessageID, taskID, taskSessionID } = args
  if (!parentSessionID || !parentMessageID) return
  // At least one of taskID/taskSessionID is required to identify the consumed task.
  if (!taskID && !taskSessionID) return

  const messageKey = getMessageKey(parentSessionID, parentMessageID)
  const existing =
    consumedTaskIdentitiesByMessage.get(messageKey) ?? new Map<string, ConsumedTaskIdentityEntry>()

  if (!consumedTaskIdentitiesByMessage.has(messageKey)) {
    consumedTaskIdentitiesByMessage.set(messageKey, existing)
  }

  const entryKey = buildConsumedEntryKey(taskID, taskSessionID)
  if (existing.has(entryKey)) return
  existing.set(entryKey, { taskID: taskID ?? undefined, taskSessionID: taskSessionID ?? undefined })
}

export function isBackgroundTaskOutputConsumption(args: {
  parentSessionID: string | undefined
  taskID?: string | undefined
  taskSessionID?: string | undefined
}): boolean {
  const { parentSessionID, taskID, taskSessionID } = args
  if (!parentSessionID) return false
  if (!taskID && !taskSessionID) return false

  const prefix = `${parentSessionID}:`
  for (const [messageKey, entries] of consumedTaskIdentitiesByMessage) {
    if (!messageKey.startsWith(prefix)) continue
    for (const entry of entries.values()) {
      if (taskID && entry.taskID === taskID) return true
      if (taskSessionID && entry.taskSessionID === taskSessionID) return true
    }
  }
  return false
}

export function restoreBackgroundOutputConsumption(
  parentSessionID: string | undefined,
  parentMessageID: string | undefined
): void {
  if (!parentSessionID || !parentMessageID) return

  const messageKey = getMessageKey(parentSessionID, parentMessageID)
  const snapshots = cursorSnapshotsByMessage.get(messageKey)
  if (snapshots) {
    cursorSnapshotsByMessage.delete(messageKey)
    for (const [taskSessionID, cursor] of snapshots) {
      restoreMessageCursor(taskSessionID, cursor)
    }
  }

  // Also drop consumed-success identity markers recorded under this message so a later
  // re-consume of the same task can suppress again only after fresh consumption.
  consumedTaskIdentitiesByMessage.delete(messageKey)
}

export function clearBackgroundOutputConsumptionsForParentSession(sessionID: string | undefined): void {
  if (!sessionID) return

  const prefix = `${sessionID}:`
  for (const messageKey of cursorSnapshotsByMessage.keys()) {
    if (messageKey.startsWith(prefix)) {
      cursorSnapshotsByMessage.delete(messageKey)
    }
  }
  for (const messageKey of consumedTaskIdentitiesByMessage.keys()) {
    if (messageKey.startsWith(prefix)) {
      consumedTaskIdentitiesByMessage.delete(messageKey)
    }
  }
}

export function clearBackgroundOutputConsumptionsForTaskSession(taskSessionID: string | undefined): void {
  if (!taskSessionID) return

  for (const [messageKey, snapshots] of cursorSnapshotsByMessage) {
    snapshots.delete(taskSessionID)
    if (snapshots.size === 0) {
      cursorSnapshotsByMessage.delete(messageKey)
    }
  }

  // Remove whole consumed identities whose taskSessionID matches; the paired taskID is part of
  // the same consumption unit and must stop suppressing too.
  for (const [messageKey, entries] of consumedTaskIdentitiesByMessage) {
    for (const [entryKey, entry] of entries) {
      if (entry.taskSessionID === taskSessionID) {
        entries.delete(entryKey)
      }
    }
    if (entries.size === 0) {
      consumedTaskIdentitiesByMessage.delete(messageKey)
    }
  }
}

export function clearBackgroundOutputConsumptionState(): void {
  cursorSnapshotsByMessage.clear()
  consumedTaskIdentitiesByMessage.clear()
}
