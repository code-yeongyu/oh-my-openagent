import { isSyntheticOrInternalUserMessage } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"

interface MessagePart {
  type?: string
  name?: string
  tool?: string
  toolName?: string
  state?: { status?: string }
  text?: string
  synthetic?: boolean
}

interface Message {
  info?: { role?: string }
  role?: string
  parts?: MessagePart[]
}

const QUESTION_TOOL_NAMES = new Set(["question", "ask_user_question", "askuserquestion"])

function getToolName(part: MessagePart): string | undefined {
  return part.name ?? part.tool ?? part.toolName
}

function isUnansweredQuestionTool(part: MessagePart): boolean {
  const toolName = getToolName(part)
  if (!QUESTION_TOOL_NAMES.has(toolName?.toLowerCase() ?? "")) {
    return false
  }
  return part.state?.status !== "completed"
}

export function hasUnansweredQuestion(messages: Message[]): boolean {
  if (!messages || messages.length === 0) return false

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const role = msg.info?.role ?? msg.role

    if (role === "user") {
      if (isSyntheticOrInternalUserMessage(msg)) {
        continue
      }
      return false
    }

    if (role === "assistant" && msg.parts) {
      const hasQuestion = msg.parts.some(
        (part) =>
          (part.type === "tool" || part.type === "tool_use" || part.type === "tool-invocation") &&
          isUnansweredQuestionTool(part),
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
