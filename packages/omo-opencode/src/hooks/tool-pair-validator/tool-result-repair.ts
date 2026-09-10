import { log } from "../../shared/logger"
import {
  findUnpairedToolParts,
  getToolCallID,
  getToolStatus,
  isTerminalToolStatus,
  toRecord,
} from "./tool-part-ids"
import type { MessageWithParts, TransformMessageInfo, TransformPart, UnpairedToolPart } from "./types"

export const INTERRUPTED_TOOL_ERROR = "[Tool execution was interrupted before it produced output]"

function getMessageID(message: TransformMessageInfo): string | undefined {
  const messageID = toRecord(message)?.["id"]
  return typeof messageID === "string" ? messageID : undefined
}

export function getMessageSessionID(message: TransformMessageInfo): string | undefined {
  const sessionID = toRecord(message)?.["sessionID"]
  return typeof sessionID === "string" ? sessionID : undefined
}

function readStartTime(state: Record<string, unknown>): number {
  const time = toRecord(state["time"])
  const start = time?.["start"]
  // Quantize fallback to a 10s bucket so repeated settlement is byte-identical.
  return typeof start === "number" ? start : Math.floor(Date.now() / 10_000) * 10_000
}

function settleToolPart(part: TransformPart): boolean {
  const state = toRecord(toRecord(part)?.["state"])
  if (!state) {
    return false
  }

  const input = toRecord(state["input"])
  const start = readStartTime(state)

  state["status"] = "error"
  state["error"] = INTERRUPTED_TOOL_ERROR
  state["input"] = input ?? {}
  // Quantize end to a 10s bucket so repeated settlement is byte-identical.
  state["time"] = { start, end: Math.floor(Date.now() / 10_000) * 10_000 }
  delete state["raw"]

  return true
}

export function repairUnpairedToolParts(message: MessageWithParts): UnpairedToolPart[] {
  const unpaired = findUnpairedToolParts(message.parts)
  if (unpaired.length === 0) {
    return []
  }

  const repaired: UnpairedToolPart[] = []
  for (const part of message.parts) {
    const callID = getToolCallID(part)
    if (!callID) {
      continue
    }

    const status = getToolStatus(part)
    if (isTerminalToolStatus(status)) {
      continue
    }

    if (settleToolPart(part)) {
      repaired.push({ callID, status })
    }
  }

  if (repaired.length === 0) {
    log("[tool-pair-validator] Unpaired tool parts could not be settled", {
      assistantMessageID: getMessageID(message.info),
      unpairedToolCallIDs: unpaired.map((item) => item.callID),
    })
    return []
  }

  log("[tool-pair-validator] Settled unpaired tool parts into a terminal error state", {
    assistantMessageID: getMessageID(message.info),
    repairedToolCallIDs: repaired.map((item) => item.callID),
    previousStatuses: repaired.map((item) => item.status),
  })

  return repaired
}

export function diagnoseSubAgentUnpairedToolParts(message: MessageWithParts, sessionID: string): void {
  const unpaired = findUnpairedToolParts(message.parts)

  log("[tool-pair-validator] Skipping repair for subagent session", {
    sessionID,
    assistantMessageID: getMessageID(message.info),
    unpairedToolCallIDs: unpaired.map((item) => item.callID),
    needsRepair: unpaired.length > 0,
  })
}
