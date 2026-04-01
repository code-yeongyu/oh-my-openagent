import type { BackgroundTask } from "./types"

const LEGACY_INTERNAL_MARKER_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/gi
const INTERNAL_MARKER_PATTERN = /\[OMO_INTERNAL\]/g
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g
const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/gi
const SYSTEM_DIRECTIVE_PATTERN = /<system-directive>[\s\S]*?<\/system-directive>/gi
const MARKDOWN_SEPARATOR_PATTERN = /^[\s-]+$/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getMessages(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw
  }
  if (isRecord(raw) && Array.isArray(raw.data)) {
    return raw.data
  }
  return []
}

function getRole(message: unknown): string | undefined {
  if (!isRecord(message) || !isRecord(message.info)) return undefined
  return typeof message.info.role === "string" ? message.info.role : undefined
}

function getParts(message: unknown): Array<{ type?: string; text?: string }> {
  if (!isRecord(message) || !Array.isArray(message.parts)) return []
  return message.parts.filter(isRecord).map((part) => ({
    type: typeof part.type === "string" ? part.type : undefined,
    text: typeof part.text === "string" ? part.text : undefined,
  }))
}

function stripInvisibleText(text: string): string {
  return text
    .replace(LEGACY_INTERNAL_MARKER_PATTERN, "")
    .replace(INTERNAL_MARKER_PATTERN, "")
    .replace(SYSTEM_REMINDER_PATTERN, "")
    .replace(SYSTEM_DIRECTIVE_PATTERN, "")
    .replace(HTML_COMMENT_PATTERN, "")
    .replace(MARKDOWN_SEPARATOR_PATTERN, "")
    .trim()
}

function getLastAssistantMessage(messages: unknown[]): unknown | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (getRole(messages[index]) === "assistant") {
      return messages[index]
    }
  }
  return null
}

export function shouldAutoContinueParentSession(rawMessages: unknown): boolean {
  const messages = getMessages(rawMessages)
  const lastAssistantMessage = getLastAssistantMessage(messages)
  if (!lastAssistantMessage) {
    return false
  }

  const parts = getParts(lastAssistantMessage)
  if (parts.length === 0) {
    return true
  }

  for (const part of parts) {
    if (part.type === "tool" || part.type === "tool_result") {
      return false
    }

    if (part.type === "text" && part.text && stripInvisibleText(part.text) !== "") {
      return false
    }
  }

  return true
}

export function buildAutoContinuePrompt(
  completedTasks: Array<Pick<BackgroundTask, "id" | "description">>,
  attempt: number,
): string {
  const completedTasksText = completedTasks
    .map((task) => `- \`${task.id}\`: ${task.description}`)
    .join("\n")

  return `[AUTO-CONTINUE AFTER EMPTY BACKGROUND REPLY]
Attempt: ${attempt}

Your previous reply contained no user-visible content. It was empty, marker-only, reasoning-only, or service-only.

Completed background tasks:
${completedTasksText}

You MUST continue now.
- Call \`background_output(task_id="<id>")\` for the relevant completed task if you need the result
- Or continue the original plan with a substantive visible reply

Do NOT output internal markers, HTML comments, raw service blocks, or reasoning-only content.`
}
