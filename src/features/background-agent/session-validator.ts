import { log } from "../../shared"

import type { OpencodeClient } from "./opencode-client"

type Todo = {
  content: string
  status: string
  priority: string
  id: string
}

type SessionMessage = {
  info?: { role?: string }
  parts?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asSessionMessages(value: unknown): SessionMessage[] {
  if (!Array.isArray(value)) return []
  return value as SessionMessage[]
}

function asParts(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

function hasNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function isToolResultContentNonEmpty(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0
  if (Array.isArray(content)) return content.length > 0
  return false
}

/**
 * Validates that a session has actual assistant/tool output before marking complete.
 * Prevents premature completion when session.idle fires before agent responds.
 */
export async function validateSessionHasOutput(
  client: OpencodeClient,
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
    })

    const messages = asSessionMessages((response as { data?: unknown }).data ?? response)

    const hasAssistantOrToolMessage = messages.some(
      (m) => m.info?.role === "assistant" || m.info?.role === "tool"
    )
    if (!hasAssistantOrToolMessage) {
      log("[background-agent] No assistant/tool messages found in session:", sessionID)
      return false
    }

    const hasContent = messages.some((m) => {
      if (m.info?.role !== "assistant" && m.info?.role !== "tool") return false

      const parts = asParts(m.parts)
      return parts.some((part) => {
        const type = part.type
        if (type === "tool") return true
        if (type === "text" && hasNonEmptyText(part.text)) return true
        if (type === "reasoning" && hasNonEmptyText(part.text)) return true
        if (type === "tool_result" && isToolResultContentNonEmpty(part.content)) return true
        return false
      })
    })

    if (!hasContent) {
      log("[background-agent] Messages exist but no content found in session:", sessionID)
      return false
    }

    return true
  } catch (error) {
    log("[background-agent] Error validating session output:", error)
    // On error, allow completion to proceed (don't block indefinitely)
    return true
  }
}

export async function checkSessionTodos(
  client: OpencodeClient,
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.todo({
      path: { id: sessionID },
    })

    const raw = (response as { data?: unknown }).data ?? response
    const todos = Array.isArray(raw) ? (raw as Todo[]) : []
    if (todos.length === 0) return false

    const incomplete = todos.filter(
      (t) => t.status !== "completed" && t.status !== "cancelled"
    )
    return incomplete.length > 0
  } catch {
    return false
  }
}
