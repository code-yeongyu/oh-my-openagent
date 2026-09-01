import type { BtwSessionMessage } from "./tui-controller-types"

const BTW_COMMAND_PATTERN = /^\/(?:btw|side)(?:\s+([\s\S]*))?$/

export function isBtwCommandDraft(input: string): boolean {
  return /^\/(?:btw|side)(?:\s|$)/.test(input.trimStart())
}

export function parseBtwQuestion(input: string): {
  consumeDraft: boolean
  question: string
} {
  if (input.length === 0) {
    return {
      consumeDraft: false,
      question: "",
    }
  }
  const match = BTW_COMMAND_PATTERN.exec(input.trim())
  if (!match) {
    return {
      consumeDraft: false,
      question: "",
    }
  }
  return {
    consumeDraft: true,
    question: match[1]?.trim() ?? "",
  }
}

export function findBtwBoundaryMessageID(
  messages: BtwSessionMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    if (message.info.role === "user") return message.info.id
    if (message.info.time?.completed !== undefined) return message.info.id
  }
  return undefined
}

