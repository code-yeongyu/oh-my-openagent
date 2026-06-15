import { isRecord } from "@oh-my-opencode/utils"
import type { TransformPart } from "./types"

export { isRecord }

const TERMINAL_OPENCODE_TOOL_STATUSES = new Set(["completed", "error"])

function isTerminalOpenCodeToolPart(part: TransformPart): boolean {
  if (!isRecord(part)) {
    return false
  }

  const candidate = part
  if (candidate.type !== "tool" || typeof candidate.callID !== "string" || candidate.callID.length === 0) {
    return false
  }

  if (!isRecord(candidate.state)) {
    return false
  }

  const status = candidate.state["status"]
  return typeof status === "string" && TERMINAL_OPENCODE_TOOL_STATUSES.has(status)
}

export function getToolUseID(part: TransformPart): string | null {
  if (!isRecord(part)) {
    return null
  }

  const candidate = part

  if (candidate.type === "tool_use" && typeof candidate.id === "string" && candidate.id.length > 0) {
    return candidate.id
  }

  if (candidate.type === "tool" && typeof candidate.callID === "string" && candidate.callID.length > 0) {
    return isTerminalOpenCodeToolPart(part) ? null : candidate.callID
  }

  return null
}

export function getToolResultID(part: TransformPart): string | null {
  if (!isRecord(part)) {
    return null
  }

  const candidate = part

  if (candidate.type !== "tool_result") {
    return null
  }

  if (typeof candidate.toolUseId === "string" && candidate.toolUseId.length > 0) {
    return candidate.toolUseId
  }

  if (typeof candidate.tool_use_id === "string" && candidate.tool_use_id.length > 0) {
    return candidate.tool_use_id
  }

  return null
}

export function extractUniqueToolUseIDs(parts: TransformPart[]): string[] {
  const seen = new Set<string>()
  const toolUseIDs: string[] = []

  for (const part of parts) {
    const toolUseID = getToolUseID(part)
    if (!toolUseID || seen.has(toolUseID)) {
      continue
    }

    seen.add(toolUseID)
    toolUseIDs.push(toolUseID)
  }

  return toolUseIDs
}

export function extractToolResultIDs(parts: TransformPart[]): Set<string> {
  const toolResultIDs = new Set<string>()

  for (const part of parts) {
    const toolResultID = getToolResultID(part)
    if (toolResultID) {
      toolResultIDs.add(toolResultID)
    }
  }

  return toolResultIDs
}
