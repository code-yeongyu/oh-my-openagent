import { messageHasContent } from "./part-content"
import { readMessages } from "./messages-reader"

export function findEmptyMessages(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const emptyIds: string[] = []

  for (const msg of messages) {
    if (!messageHasContent(msg.id)) {
      emptyIds.push(msg.id)
    }
  }

  return emptyIds
}

export function findEmptyMessageByIndex(sessionID: string, targetIndex: number): string | null {
  const messages = readMessages(sessionID)

  const indicesToTry = [
    targetIndex,
    targetIndex - 1,
    targetIndex + 1,
    targetIndex - 2,
    targetIndex + 2,
    targetIndex - 3,
    targetIndex - 4,
    targetIndex - 5,
  ]

  for (const index of indicesToTry) {
    if (index < 0 || index >= messages.length) continue

    const targetMessage = messages[index]

    if (!messageHasContent(targetMessage.id)) {
      return targetMessage.id
    }
  }

  return null
}

export function findFirstEmptyMessage(sessionID: string): string | null {
  const emptyIds = findEmptyMessages(sessionID)
  return emptyIds.length > 0 ? emptyIds[0] : null
}
