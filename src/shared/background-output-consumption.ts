import { getMessageCursor, restoreMessageCursor, type CursorState } from "./session-cursor"

type MessageConsumptionKey = `${string}:${string}`

const cursorSnapshotsByMessage = new Map<MessageConsumptionKey, Map<string, CursorState | undefined>>()

function getMessageKey(sessionID: string, messageID: string): MessageConsumptionKey {
  return `${sessionID}:${messageID}`
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
}

export function restoreBackgroundOutputConsumption(
  parentSessionID: string | undefined,
  parentMessageID: string | undefined
): void {
  if (!parentSessionID || !parentMessageID) return

  const messageKey = getMessageKey(parentSessionID, parentMessageID)
  const snapshots = cursorSnapshotsByMessage.get(messageKey)
  if (!snapshots) return

  cursorSnapshotsByMessage.delete(messageKey)
  for (const [taskSessionID, cursor] of snapshots) {
    restoreMessageCursor(taskSessionID, cursor)
  }
}

export function clearBackgroundOutputConsumptionsForParentSession(sessionID: string | undefined): void {
  if (!sessionID) return

  const prefix = `${sessionID}:`
  for (const messageKey of cursorSnapshotsByMessage.keys()) {
    if (messageKey.startsWith(prefix)) {
      cursorSnapshotsByMessage.delete(messageKey)
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
}

export function clearBackgroundOutputConsumptionState(): void {
  cursorSnapshotsByMessage.clear()
}
