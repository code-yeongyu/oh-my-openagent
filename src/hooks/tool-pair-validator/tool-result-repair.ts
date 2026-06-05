import { log } from "../../shared/logger"
import { extractToolResultIDs, extractUniqueToolUseIDs, getToolResultID, isRecord } from "./tool-part-ids"
import type { MessageWithParts, ToolResultPart, TransformMessageInfo, TransformPart } from "./types"

const TOOL_RESULT_PLACEHOLDER = "Tool output unavailable (context compacted)"
const TOOL_RESULT_RECOVERY_CONTINUATION = "Recovered missing tool results. Continue from the repaired tool output."

function createToolResultPart(toolUseID: string): ToolResultPart {
  return {
    type: "tool_result",
    toolUseId: toolUseID,
    tool_use_id: toolUseID,
    isError: true,
    content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
  }
}

function findToolResultInsertIndex(parts: TransformPart[]): number {
  let lastToolResultIndex = -1

  for (let i = 0; i < parts.length; i++) {
    if (getToolResultID(parts[i])) {
      lastToolResultIndex = i
    }
  }

  return lastToolResultIndex === -1 ? 0 : lastToolResultIndex + 1
}

function insertMissingToolResults(message: MessageWithParts, missingToolUseIDs: string[]): void {
  const toolResultParts = missingToolUseIDs.map((toolUseID) => createToolResultPart(toolUseID))
  const insertIndex = findToolResultInsertIndex(message.parts)
  message.parts.splice(insertIndex, 0, ...toolResultParts)
}

function createSyntheticUserMessage(assistantMessage: MessageWithParts, missingToolUseIDs: string[]): MessageWithParts {
  const sessionID = getMessageSessionID(assistantMessage.info)

  return {
    info: {
      role: "user",
      ...(sessionID ? { sessionID } : {}),
    },
    parts: [
      ...missingToolUseIDs.map((toolUseID) => createToolResultPart(toolUseID)),
      {
        type: "text",
        text: TOOL_RESULT_RECOVERY_CONTINUATION,
        synthetic: true,
      },
    ],
  }
}

function getMessageID(message: TransformMessageInfo): string | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  const messageRecord: Record<string, unknown> = message
  const messageID = messageRecord["id"]
  return typeof messageID === "string" ? messageID : undefined
}

export function getMessageSessionID(message: TransformMessageInfo): string | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  const messageRecord: Record<string, unknown> = message
  const sessionID = messageRecord["sessionID"]
  return typeof sessionID === "string" ? sessionID : undefined
}

type MissingToolResultAnalysis = {
  assistantMessageID: string | undefined
  toolUseIDs: string[]
  needsRepair: false
} | {
  assistantMessageID: string | undefined
  toolUseIDs: string[]
  needsRepair: true
  missingToolUseIDs: string[]
  syntheticUserMessageInserted: boolean
  nextRole: string | undefined
}

function analyzeMissingToolResults(messages: MessageWithParts[], assistantIndex: number): MissingToolResultAnalysis {
  const assistantMessage = messages[assistantIndex]
  const assistantMessageID = getMessageID(assistantMessage.info)
  const toolUseIDs = extractUniqueToolUseIDs(assistantMessage.parts)

  if (toolUseIDs.length === 0) {
    return { assistantMessageID, toolUseIDs, needsRepair: false }
  }

  const nextMessage = messages[assistantIndex + 1]
  const nextRole = nextMessage?.info.role

  if (nextRole !== "user") {
    return {
      assistantMessageID,
      toolUseIDs,
      needsRepair: true,
      missingToolUseIDs: toolUseIDs,
      syntheticUserMessageInserted: true,
      nextRole,
    }
  }

  const existingToolResultIDs = extractToolResultIDs(nextMessage.parts)
  const missingToolUseIDs = toolUseIDs.filter((toolUseID) => !existingToolResultIDs.has(toolUseID))

  if (missingToolUseIDs.length === 0) {
    return { assistantMessageID, toolUseIDs, needsRepair: false }
  }

  return {
    assistantMessageID,
    toolUseIDs,
    needsRepair: true,
    missingToolUseIDs,
    syntheticUserMessageInserted: false,
    nextRole,
  }
}

export function repairSubAgentMissingToolResults(
  messages: MessageWithParts[],
  assistantIndex: number,
  sessionID: string
): void {
  const analysis = analyzeMissingToolResults(messages, assistantIndex)

  if (!analysis.needsRepair) {
    log("[tool-pair-validator] Skipping repair for subagent session", {
      sessionID,
      assistantMessageID: analysis.assistantMessageID,
      toolUseCount: analysis.toolUseIDs.length,
      needsRepair: false,
    })
    return
  }

  log("[tool-pair-validator] Skipping repair for subagent session", {
    sessionID,
    assistantMessageID: analysis.assistantMessageID,
    toolUseIDs: analysis.toolUseIDs,
    missingToolUseIDs: analysis.missingToolUseIDs,
    syntheticUserMessageInserted: analysis.syntheticUserMessageInserted,
    nextRole: analysis.nextRole ?? "missing",
    needsRepair: true,
  })
}

export function repairMissingToolResults(messages: MessageWithParts[], assistantIndex: number): void {
  const analysis = analyzeMissingToolResults(messages, assistantIndex)

  if (!analysis.needsRepair) {
    return
  }

  const assistantMessage = messages[assistantIndex]

  if (analysis.syntheticUserMessageInserted) {
    messages.splice(assistantIndex + 1, 0, createSyntheticUserMessage(assistantMessage, analysis.missingToolUseIDs))
    log("[tool-pair-validator] Repaired missing tool_result blocks", {
      assistantMessageID: analysis.assistantMessageID,
      syntheticUserMessageInserted: true,
      repairedToolUseIDs: analysis.missingToolUseIDs,
    })
    return
  }

  const nextMessage = messages[assistantIndex + 1]
  if (!nextMessage || nextMessage.info.role !== "user") {
    return
  }

  insertMissingToolResults(nextMessage, analysis.missingToolUseIDs)
  log("[tool-pair-validator] Repaired missing tool_result blocks", {
    assistantMessageID: analysis.assistantMessageID,
    syntheticUserMessageInserted: false,
    repairedToolUseIDs: analysis.missingToolUseIDs,
  })
}
