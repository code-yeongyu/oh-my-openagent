import {
  messageCompleted,
  messageFinish,
  messageHasUnresolvedTool,
  messageHasWaitingTool,
  messageIsSyntheticOrInternalUser,
  messageRole,
} from "../../shared/prompt-async-gate/prompt-message-state"
import { isEmptyNoProgressAssistantTurnInfo } from "./empty-assistant-turn"
import { isRecord } from "./error-classifier"
import { getParentWakeMessageCreatedAt } from "./parent-wake-message-activity"
import type { PendingParentWake } from "./parent-wake-dedupe"

export function latestAssistantTurnIsCompletedEmptyNoProgress(messages: readonly unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = messageRole(message)
    if (role === "assistant") {
      const info = isRecord(message) && isRecord(message.info) ? message.info : message
      return messageCompleted(message) && isEmptyNoProgressAssistantTurnInfo(info)
    }
    if (role === "user" && !messageIsSyntheticOrInternalUser(message)) {
      return false
    }
  }
  return false
}

export function latestAssistantTurnHasToolBlock(messages: readonly unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = messageRole(message)
    if (role === "assistant") {
      return messageFinish(message) === "tool-calls"
        || messageHasWaitingTool(message)
        || messageHasUnresolvedTool(message)
    }
    if (role === "user" && !messageIsSyntheticOrInternalUser(message)) {
      return false
    }
  }
  return false
}

export function latestAssistantTurnHasFreshToolActivity(
  messages: readonly unknown[],
  now: number,
  maxAgeMs: number,
): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = messageRole(message)
    if (role === "assistant") {
      if (!isRecord(message) || !Array.isArray(message.parts)) {
        return false
      }
      const createdAt = getParentWakeMessageCreatedAt(message)
      if (createdAt !== undefined && now - createdAt <= maxAgeMs) {
        return true
      }
      return message.parts.some((part) => partHasFreshToolActivity(part, now, maxAgeMs))
    }
    if (role === "user" && !messageIsSyntheticOrInternalUser(message)) {
      return false
    }
  }
  return false
}

export function createEmptyAssistantTurnRetryDedupeKey(wake: PendingParentWake): string {
  return [
    "background-agent-parent-wake-empty-retry",
    ...wake.notifications,
    JSON.stringify(wake.promptContext),
    wake.shouldReply ? "reply" : "silent",
  ].join("\u0000")
}

function partHasFreshToolActivity(part: unknown, now: number, maxAgeMs: number): boolean {
  if (!isRecord(part)) {
    return false
  }
  return timeHasFreshActivity(part.time, now, maxAgeMs) || timeHasFreshActivity(
    isRecord(part.state) ? part.state.time : undefined,
    now,
    maxAgeMs,
  )
}

function timeHasFreshActivity(time: unknown, now: number, maxAgeMs: number): boolean {
  if (!isRecord(time)) {
    return false
  }
  const values = [time.start, time.end, time.created, time.updated]
  return values.some((value) => typeof value === "number" && Number.isFinite(value) && now - value <= maxAgeMs)
}
