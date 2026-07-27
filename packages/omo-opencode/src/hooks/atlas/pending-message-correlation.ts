const MAX_PENDING_MESSAGES_PER_SESSION = 64
const MAX_PENDING_MESSAGE_ID_LENGTH = 256

export type PendingMessageCorrelation = Map<string, Set<string>>

export function rememberPendingMessage(
  pendingMessages: PendingMessageCorrelation,
  sessionID: string,
  messageID: string,
): void {
  if (messageID.length > MAX_PENDING_MESSAGE_ID_LENGTH) return
  const messageIDs = pendingMessages.get(sessionID) ?? new Set<string>()
  if (messageIDs.size >= MAX_PENDING_MESSAGES_PER_SESSION) {
    const oldestMessageID = messageIDs.values().next().value
    if (oldestMessageID !== undefined) messageIDs.delete(oldestMessageID)
  }
  messageIDs.add(messageID)
  pendingMessages.set(sessionID, messageIDs)
}

export function hasPendingMessage(
  pendingMessages: PendingMessageCorrelation,
  sessionID: string,
  messageID: string,
): boolean {
  return pendingMessages.get(sessionID)?.has(messageID) === true
}

export function consumePendingMessage(
  pendingMessages: PendingMessageCorrelation,
  sessionID: string,
  messageID: string,
): boolean {
  const messageIDs = pendingMessages.get(sessionID)
  if (!messageIDs?.delete(messageID)) return false
  if (messageIDs.size === 0) pendingMessages.delete(sessionID)
  return true
}
