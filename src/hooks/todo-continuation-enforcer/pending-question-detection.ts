import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"

interface MessagePart {
  type?: string
  name?: string
  toolName?: string
}

interface Message {
  info?: { role?: string }
  role?: string
  parts?: MessagePart[]
}

export function hasUnansweredQuestion(messages: Message[]): boolean {
  if (!messages || messages.length === 0) return false

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const role = msg.info?.role ?? msg.role

    if (role === "user") return false

    if (role === "assistant" && msg.parts) {
      const hasQuestion = msg.parts.some(
        (part) =>
          (part.type === "tool_use" || part.type === "tool-invocation") &&
          (part.name === "question" || part.toolName === "question"),
      )
      if (hasQuestion) {
        log(`[${HOOK_NAME}] Detected pending question tool in last assistant message`)
        return true
      }
      return false
    }
  }

  return false
}
