import { isRecord } from "@oh-my-opencode/utils"
import { extractTaskLink } from "../tool-metadata-store"
import type { BackgroundTask } from "./types"

const BACKGROUND_TASK_ID_PATTERN = /(?:Background )?Task ID:\s*(bg[_-][a-zA-Z0-9_-]+)/i
const DESCRIPTION_PATTERN = /^Description:\s*(.+)$/im
const AGENT_PATTERN = /^Agent:\s*([^\n(]+)/im

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function match(output: string, pattern: RegExp): string | undefined {
  return readString(pattern.exec(output)?.[1])
}

function recoverFromPart(part: unknown, targetID: string, parentSessionID: string): BackgroundTask | undefined {
  if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state)) {
    return undefined
  }

  const output = readString(part.state.output)
  if (!output) {
    return undefined
  }

  const metadataLink = extractTaskLink(part.state.metadata, "")
  const outputLink = extractTaskLink(undefined, output)
  const metadata = isRecord(part.state.metadata) ? part.state.metadata : undefined
  const taskID = metadataLink.backgroundTaskId
    ?? outputLink.backgroundTaskId
    ?? match(output, BACKGROUND_TASK_ID_PATTERN)
  const sessionID = metadataLink.sessionId ?? outputLink.sessionId
  if (!taskID || !sessionID || (targetID !== taskID && targetID !== sessionID)) {
    return undefined
  }

  return {
    id: taskID,
    sessionId: sessionID,
    parentSessionId: parentSessionID,
    parentMessageId: "",
    description: readString(metadata?.description) ?? match(output, DESCRIPTION_PATTERN) ?? taskID,
    prompt: "[recovered]",
    agent: metadataLink.agent ?? outputLink.agent ?? match(output, AGENT_PATTERN) ?? "task",
    category: metadataLink.category ?? outputLink.category,
    status: "completed",
    completedAt: new Date(),
  }
}

export function recoverBackgroundTask(
  messages: readonly unknown[],
  targetID: string,
  parentSessionID: string,
): BackgroundTask | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!isRecord(message) || !Array.isArray(message.parts)) {
      continue
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const task = recoverFromPart(message.parts[partIndex], targetID, parentSessionID)
      if (task) {
        return task
      }
    }
  }

  return undefined
}
