import type { GcPart, MessageWithParts } from "./types"
import { parseMarkers } from "./reference-marker"

type ToolPartShape = {
  type: string
  state?: {
    output?: string
  }
}

type TextPartShape = {
  type: string
  text?: string
}

const RECALL_HINT = [
  "[context-gc] Some earlier messages were compressed. Data replaced with [brain#ID: description] markers.",
  "To recall the full content of any marker, run: nous-memory get <ID>",
  "Example: nous-memory get 42",
].join("\n")

const injectedSessions = new Set<string>()

function collectBrainIdsFromParts(parts: GcPart[]): number[] {
  const ids: number[] = []

  for (const part of parts) {
    const toolPart = part as ToolPartShape
    if (toolPart.type === "tool" && toolPart.state?.output) {
      for (const marker of parseMarkers(toolPart.state.output)) {
        ids.push(marker.brainId)
      }
    }

    const textPart = part as TextPartShape
    if (textPart.type === "text" && textPart.text) {
      for (const marker of parseMarkers(textPart.text)) {
        ids.push(marker.brainId)
      }
    }
  }

  return ids
}

export function collectBrainIds(messages: MessageWithParts[]): number[] {
  const ids: number[] = []

  for (const message of messages) {
    ids.push(...collectBrainIdsFromParts(message.parts))
  }

  return [...new Set(ids)]
}

export function shouldInjectRecallHint(messages: MessageWithParts[]): boolean {
  return collectBrainIds(messages).length > 0
}

export function injectRecallHint(messages: MessageWithParts[], sessionID?: string): boolean {
  if (!shouldInjectRecallHint(messages)) {
    return false
  }

  // Only inject once per session
  if (sessionID) {
    if (injectedSessions.has(sessionID)) return false
    injectedSessions.add(sessionID)
  }

  const lastUserIndex = findLastUserMessageIndex(messages)
  if (lastUserIndex === -1) {
    return false
  }

  const lastUserMessage = messages[lastUserIndex]
  const alreadyHasHint = lastUserMessage.parts.some((part) => {
    const textPart = part as TextPartShape
    return textPart.type === "text" && textPart.text?.includes("[context-gc]")
  })

  if (alreadyHasHint) {
    return false
  }

  const hintPart: GcPart = {
    type: "text",
    text: RECALL_HINT,
  }

  lastUserMessage.parts.push(hintPart)
  return true
}

function findLastUserMessageIndex(messages: MessageWithParts[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "user") {
      return i
    }
  }
  return -1
}

export function getRecallHintText(): string {
  return RECALL_HINT
}

export function clearRecallHintSession(sessionID: string): void {
  injectedSessions.delete(sessionID)
}
