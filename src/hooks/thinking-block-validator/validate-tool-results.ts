// Pre-flight tool_result validation — runs for ALL models before API submission.
// Handles: consecutive assistant messages + missing tool_result in user messages.

import type { Message, Part } from "@opencode-ai/sdk"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

interface ExtendedPart {
  callID?: string
  id?: string
  type: string
  tool_use_id?: string
}

interface ExtendedInfo {
  id?: string
  sessionID?: string
}

// Prefers callID (toolu_*) over id (prt_*) for API compatibility
function getToolCallId(part: Part): string | undefined {
  const p = part as unknown as ExtendedPart
  return p.callID || p.id
}

function extractToolUseIds(parts: Part[]): string[] {
  if (!parts) return []
  return parts
    .filter((p) => {
      const type = p.type as string
      return (type === "tool_use" || type === "tool") && getToolCallId(p)
    })
    .map((p) => getToolCallId(p)!)
}

// Must run before thinking block validation (may insert synthetic messages)
export function validateToolResults(messages: MessageWithParts[]): void {
  const insertions: { index: number; message: MessageWithParts }[] = []

  for (let i = 0; i < messages.length - 1; i++) {
    const current = messages[i]
    const next = messages[i + 1]

    if (current?.info?.role === "assistant" && next?.info?.role === "assistant") {
      const toolUseIds = extractToolUseIds(current.parts)
      if (toolUseIds.length > 0) {
        const sessionID = (current.info as unknown as ExtendedInfo).sessionID || ""
        insertions.push({
          index: i + 1,
          message: createSyntheticToolResultMessage(toolUseIds, sessionID, i),
        })
      }
    }

    if (current?.info?.role === "assistant" && next?.info?.role === "user") {
      const toolUseIds = extractToolUseIds(current.parts)
      if (toolUseIds.length > 0) {
        appendMissingToolResults(toolUseIds, next, current.info)
      }
    }
  }

  for (let j = insertions.length - 1; j >= 0; j--) {
    messages.splice(insertions[j].index, 0, insertions[j].message)
  }
}

function createSyntheticToolResultMessage(
  toolUseIds: string[],
  sessionID: string,
  index: number
): MessageWithParts {
  const timestamp = Date.now()
  const messageID = `msg_synthetic_${timestamp}_${index}`

  const parts = toolUseIds.map((toolUseId) => ({
    type: "tool_result" as const,
    id: `prt_synthetic_${timestamp}_${toolUseId.slice(-8)}`,
    sessionID,
    messageID,
    tool_use_id: toolUseId,
    content: "Tool execution was interrupted before completion.",
    is_error: true,
    synthetic: true,
  }))

  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      synthetic: true,
    } as unknown as Message,
    parts: parts as unknown as Part[],
  }
}

function appendMissingToolResults(
  toolUseIds: string[],
  userMessage: MessageWithParts,
  assistantInfo: Message
): void {
  const existingResultIds = new Set(
    (userMessage.parts || [])
      .filter((p) => {
        const part = p as unknown as ExtendedPart
        return (p.type as string) === "tool_result" && part.tool_use_id
      })
      .map((p) => (p as unknown as ExtendedPart).tool_use_id!)
  )

  const missingIds = toolUseIds.filter((id) => !existingResultIds.has(id))
  if (missingIds.length === 0) return

  const sessionID = (assistantInfo as unknown as ExtendedInfo).sessionID || ""
  const messageID = (userMessage.info as unknown as ExtendedInfo).id || `msg_synthetic_${Date.now()}`
  const timestamp = Date.now()
  const syntheticParts = missingIds.map((toolUseId) => ({
    type: "tool_result" as const,
    id: `prt_synthetic_${timestamp}_${toolUseId.slice(-8)}`,
    sessionID,
    messageID,
    tool_use_id: toolUseId,
    content: "Tool execution was interrupted before completion.",
    is_error: true,
    synthetic: true,
  }))

  userMessage.parts = [...(userMessage.parts || []), ...(syntheticParts as unknown as Part[])]
}
