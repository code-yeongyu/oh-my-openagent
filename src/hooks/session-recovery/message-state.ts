import type { MessageData } from "./types"

export function assistantMessageIsFinished(message: MessageData): boolean {
  if (message.info?.error) {
    return true
  }

  const finish = message.info?.finish
  if (finish === "tool-calls") {
    return false
  }
  if ((typeof finish === "string" && finish.length > 0) || finish === true) {
    return true
  }

  const completed = message.info?.time?.completed
  if (typeof completed === "number" && Number.isFinite(completed)) {
    return true
  }
  return typeof completed === "string" && completed.length > 0
}

function partHasValidToolUseID(part: NonNullable<MessageData["parts"]>[number]): boolean {
  const callID = part.callID
  if (typeof callID === "string" && /^(toolu_|call_)/.test(callID)) {
    return true
  }

  const id = part.id
  return typeof id === "string" && /^(toolu_|call_)/.test(id)
}

export function messageHasInterruptedToolResults(message: MessageData): boolean {
  return message.parts?.some((part) =>
    (part.type === "tool" || part.type === "tool_use")
    && (part.state?.status === "pending" || part.state?.status === "running")
    && partHasValidToolUseID(part)
  ) === true
}

export function findLatestAssistantMessage(messages: MessageData[]): MessageData | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = message?.info?.role
    if (role === "user") {
      return undefined
    }
    if (role === "assistant") {
      return message
    }
  }
  return undefined
}
