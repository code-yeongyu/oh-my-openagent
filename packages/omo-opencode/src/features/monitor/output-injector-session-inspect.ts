import {
  isSyntheticOrInternalUserMessage,
  log,
  normalizeSDKResponse,
} from "../../shared"
import { latestAssistantTurnBlocksInternalPrompt } from "../../shared/prompt-async-gate/pending-tool-turn"
import type { DispatchedMonitorOutput, MonitorPromptClient, MonitorSessionMessage } from "./output-injector-types"

export async function loadMonitorSessionMessages(
  client: MonitorPromptClient,
  directory: string,
  sessionID: string,
): Promise<MonitorSessionMessage[]> {
  try {
    const messagesResp = await client.session?.messages?.({
      path: { id: sessionID },
      query: { directory },
    })
    return normalizeSDKResponse(messagesResp, [] as MonitorSessionMessage[])
  } catch (error) {
    log("[monitor] Failed to inspect parent session messages for output injection safety:", { sessionID, error })
    return []
  }
}

export function getMessageRole(message: MonitorSessionMessage): string | undefined {
  return message.info?.role ?? message.role
}

export function getMessageCreatedAt(message: MonitorSessionMessage): number | undefined {
  const value = message.info?.time?.created ?? message.time?.created
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  return undefined
}

export async function isUserMessageInProgress(
  client: MonitorPromptClient,
  directory: string,
  sessionID: string,
  now: number,
  userMessageInProgressWindowMs: number,
): Promise<boolean> {
  if (userMessageInProgressWindowMs <= 0) {
    return false
  }
  const messages = await loadMonitorSessionMessages(client, directory, sessionID)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) {
      continue
    }
    const role = getMessageRole(message)
    if (role === "user") {
      if (isSyntheticOrInternalUserMessage(message)) {
        continue
      }
      const createdAt = getMessageCreatedAt(message)
      if (createdAt === undefined) {
        return false
      }
      return now - createdAt <= userMessageInProgressWindowMs
    }
    if (role === "assistant" || role === "tool") {
      return false
    }
  }
  return false
}

export function monitorMessageHasOutput(message: MonitorSessionMessage): boolean {
  const role = getMessageRole(message)
  if (role !== "assistant" && role !== "tool") {
    return false
  }
  if (!message.parts || message.parts.length === 0) {
    return role === "assistant"
  }
  return message.parts.some((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return typeof part.text === "string" && part.text.trim().length > 0
    }
    if (
      part.type === "tool"
      || part.type === "tool_use"
      || part.type === "tool-call"
      || part.type === "tool-invocation"
      || part.type === "tool_result"
      || part.type === "tool-result"
    ) {
      return true
    }
    if (part.content !== undefined) {
      if (typeof part.content === "string") {
        return part.content.trim().length > 0
      }
      if (Array.isArray(part.content)) {
        return part.content.length > 0
      }
      return true
    }
    return false
  })
}

export function monitorMessageContainsBatch(message: MonitorSessionMessage, output: DispatchedMonitorOutput): boolean {
  if (getMessageRole(message) !== "user") {
    return false
  }
  const monitorMarker = `monitor_id: ${output.record.id}`
  const batchMarker = `batch: ${output.batch.batchSeq}`
  return message.parts?.some((part) =>
    typeof part.text === "string"
    && part.text.includes("[OMO MONITOR OUTPUT]")
    && part.text.includes(monitorMarker)
    && part.text.includes(batchMarker)
  ) ?? false
}

export async function hasAcceptedMessageAfterDispatchedMonitorOutput(
  client: MonitorPromptClient,
  directory: string,
  sessionID: string,
  output: DispatchedMonitorOutput,
  acceptedMessageSkewMs: number,
): Promise<boolean> {
  const messages = await loadMonitorSessionMessages(client, directory, sessionID)
  return messages.some((message) => {
    const createdAt = getMessageCreatedAt(message)
    if (createdAt === undefined) {
      return false
    }
    if (
      createdAt >= output.dispatchedAt - acceptedMessageSkewMs
      && monitorMessageContainsBatch(message, output)
    ) {
      return true
    }
    return createdAt >= output.dispatchedAt && monitorMessageHasOutput(message)
  })
}

export async function latestAssistantTurnBlocksMonitorOutput(
  client: MonitorPromptClient,
  directory: string,
  sessionID: string,
): Promise<boolean> {
  const messages = await loadMonitorSessionMessages(client, directory, sessionID)
  return latestAssistantTurnBlocksInternalPrompt(messages)
}
