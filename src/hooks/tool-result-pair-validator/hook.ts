/**
 * Proactive Tool Result Pair Validator Hook
 *
 * Prevents "tool_use ids were found without tool_result blocks" errors
 * by validating tool_use/tool_result pairing BEFORE sending to the API.
 *
 * When compaction or context-window-limit-recovery removes a user message
 * containing tool_result while keeping the assistant message with tool_use,
 * the Anthropic API rejects the request. This hook detects orphaned tool_use
 * blocks and injects synthetic tool_result parts to restore valid pairing.
 *
 * Runs as the LAST step in experimental.chat.messages.transform,
 * after context-injector and thinking-block-validator.
 */

import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared/logger"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

function isValidToolCallID(id: unknown): id is string {
  return typeof id === "string" && /^(toolu_|call_)/.test(id)
}

function extractToolUseIdsFromAssistant(parts: Part[]): string[] {
  if (!parts || parts.length === 0) return []

  const ids: string[] = []
  for (const part of parts) {
    const type = (part as { type: string }).type
    if (type !== "tool" && type !== "tool_use") continue

    const callID =
      (part as { callID?: unknown }).callID ??
      (part as { id?: unknown }).id
    if (isValidToolCallID(callID)) {
      ids.push(callID)
    }
  }
  return ids
}

function extractToolResultIdsFromUser(parts: Part[]): Set<string> {
  if (!parts || parts.length === 0) return new Set()

  const ids = new Set<string>()
  for (const part of parts) {
    const type = (part as { type: string }).type
    if (type !== "tool" && type !== "tool_result") continue

    const callID =
      (part as { callID?: unknown }).callID ??
      (part as { tool_use_id?: unknown }).tool_use_id
    if (typeof callID === "string" && callID.length > 0) {
      ids.add(callID)
    }
  }
  return ids
}

function createSyntheticToolResultPart(toolUseId: string): Part {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: "[tool result unavailable - recovered by tool-result-pair-validator]",
  } as Part
}

export function createToolResultPairValidatorHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (!messages || messages.length === 0) return

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (msg.info.role !== "assistant") continue

        const toolUseIds = extractToolUseIdsFromAssistant(msg.parts)
        if (toolUseIds.length === 0) continue

        const nextMsg = messages[i + 1]
        const isNextUser = nextMsg?.info.role === "user"

        if (!isNextUser) {
          const syntheticParts = toolUseIds.map(createSyntheticToolResultPart)
          const syntheticMessage: MessageWithParts = {
            info: {
              id: `synthetic_tool_result_${i}_${Date.now()}`,
              role: "user",
            } as Message,
            parts: syntheticParts,
          }

          messages.splice(i + 1, 0, syntheticMessage)
          log("[tool-result-pair-validator] Injected synthetic user message", {
            afterIndex: i,
            toolUseIds,
          })
          continue
        }

        const existingResultIds = extractToolResultIdsFromUser(nextMsg.parts)
        const missingIds = toolUseIds.filter((id) => !existingResultIds.has(id))

        if (missingIds.length > 0) {
          for (const id of missingIds) {
            nextMsg.parts.push(createSyntheticToolResultPart(id))
          }
          log("[tool-result-pair-validator] Injected missing tool_result parts", {
            messageIndex: i + 1,
            missingIds,
          })
        }
      }
    },
  }
}
