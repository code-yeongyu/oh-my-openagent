import {
  isSyntheticOrInternalUserMessage,
  isTerminalNoReplyUserMessage,
  type InternalInitiatorMessageLike,
  type InternalInitiatorTextPartLike,
} from "../internal-initiator-marker"
import { isRecord } from "../record-type-guard"

export function messageRole(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined
  }
  const info = message.info
  if (isRecord(info) && typeof info.role === "string") {
    return info.role
  }
  return typeof message.role === "string" ? message.role : undefined
}

export function messageFinish(message: unknown): string | true | undefined {
  if (!isRecord(message)) {
    return undefined
  }
  const info = message.info
  if (isRecord(info)) {
    if (info.finish === true) {
      return true
    }
    if (typeof info.finish === "string" && info.finish.length > 0) {
      return info.finish
    }
  }
  if (message.finish === true) {
    return true
  }
  return typeof message.finish === "string" && message.finish.length > 0 ? message.finish : undefined
}

export function messageCompleted(message: unknown): boolean {
  if (!isRecord(message)) {
    return false
  }
  const info = message.info
  const time = isRecord(info) && isRecord(info.time) ? info.time : undefined
  const completed = time?.completed
  if (typeof completed === "number" && Number.isFinite(completed)) {
    return true
  }
  return typeof completed === "string" && completed.length > 0
}

export function messageHasTerminalError(message: unknown): boolean {
  if (!isRecord(message)) {
    return false
  }
  const info = message.info
  if (isRecord(info) && info.error !== undefined && info.error !== null) {
    return true
  }
  return message.error !== undefined && message.error !== null
}

function toInternalInitiatorTextPartLike(part: unknown): InternalInitiatorTextPartLike {
  const result: InternalInitiatorTextPartLike = {}
  if (!isRecord(part)) {
    return result
  }

  if (typeof part.type === "string") {
    result.type = part.type
  }
  if (typeof part.text === "string") {
    result.text = part.text
  }
  if (typeof part.synthetic === "boolean") {
    result.synthetic = part.synthetic
  }
  return result
}

function toInternalInitiatorMessageLike(message: unknown): InternalInitiatorMessageLike | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  const result: InternalInitiatorMessageLike = {}
  const info = message.info
  if (isRecord(info) && typeof info.role === "string") {
    result.info = { role: info.role }
  }
  if (typeof message.role === "string") {
    result.role = message.role
  }
  if (Array.isArray(message.parts)) {
    result.parts = message.parts.map(toInternalInitiatorTextPartLike)
  }
  return result
}

export function messageIsSyntheticOrInternalUser(message: unknown): boolean {
  const initiatorMessage = toInternalInitiatorMessageLike(message)
  return initiatorMessage !== undefined && isSyntheticOrInternalUserMessage(initiatorMessage)
}

export function messageIsTerminalNoReplyUser(message: unknown): boolean {
  const initiatorMessage = toInternalInitiatorMessageLike(message)
  return initiatorMessage !== undefined && isTerminalNoReplyUserMessage(initiatorMessage)
}

const QUESTION_TOOL_NAMES = new Set(["question", "ask_user_question", "askuserquestion"])

function partToolName(part: Record<string, unknown>): string | undefined {
  if (typeof part.name === "string") {
    return part.name
  }
  if (typeof part.tool === "string") {
    return part.tool
  }
  return typeof part.toolName === "string" ? part.toolName : undefined
}

function partIsToolCall(part: Record<string, unknown>): boolean {
  return (
    part.type === "tool"
    || part.type === "tool_use"
    || part.type === "tool-call"
    || part.type === "tool-invocation"
  )
}

function partIsQuestionTool(part: unknown): boolean {
  if (!isRecord(part) || !partIsToolCall(part)) {
    return false
  }
  const toolName = partToolName(part)
  return toolName !== undefined && QUESTION_TOOL_NAMES.has(toolName.toLowerCase())
}

function partIsUnansweredQuestionTool(part: unknown): boolean {
  if (!partIsQuestionTool(part) || !isRecord(part)) {
    return false
  }
  const state = part.state
  if (!isRecord(state)) {
    return true
  }
  return state.status !== "completed"
}

function partIsWaitingOnTool(part: unknown): boolean {
  if (!isRecord(part)) {
    return false
  }
  if (!partIsToolCall(part)) {
    return false
  }

  const state = part.state
  if (!isRecord(state)) {
    return false
  }
  return state.status === "pending" || state.status === "running"
}

function partIsUnresolvedTool(part: unknown): boolean {
  if (!isRecord(part) || !partIsToolCall(part)) {
    return false
  }
  const state = part.state
  if (!isRecord(state)) {
    return true
  }
  return state.status !== "completed"
}

function partHasSubstantiveAssistantOutput(part: unknown): boolean {
  if (!isRecord(part)) {
    return false
  }
  if (part.type === "step-start" || part.type === "step-finish") {
    return false
  }
  if (part.type === "text") {
    return typeof part.text === "string" && part.text.trim().length > 0
  }
  return typeof part.type === "string" && part.type.length > 0
}

export function messageHasQuestionTool(message: unknown): boolean {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partIsUnansweredQuestionTool)
}

export function messageHasWaitingTool(message: unknown): boolean {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partIsWaitingOnTool)
}

export function messageHasUnresolvedTool(message: unknown): boolean {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partIsUnresolvedTool)
}

export function messageHasSubstantiveAssistantOutput(message: unknown): boolean {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partHasSubstantiveAssistantOutput)
}
