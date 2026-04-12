const BACKGROUND_NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])

type TimeLike = {
  created?: number | string
  completed?: number | string
}

type MessageTimeLike = TimeLike | string

type ToolResultBlockLike = {
  type?: string
  text?: string
}

export type BackgroundSessionMessagePartLike = {
  type?: string
  text?: string
  content?: string | ToolResultBlockLike[]
  output?: string
}

export type BackgroundSessionMessageLike = {
  info?: {
    role?: string
    finish?: string
    time?: MessageTimeLike
  }
  parts?: BackgroundSessionMessagePartLike[]
}

function getSessionMessageTimestamp(message: BackgroundSessionMessageLike, key: keyof TimeLike): number {
  const time = message.info?.time
  if (typeof time === "string") {
    const parsedNumber = Number(time)
    if (Number.isFinite(parsedNumber)) {
      return parsedNumber
    }
    const parsedDate = Date.parse(time)
    return Number.isFinite(parsedDate) ? parsedDate : 0
  }

  const value = time?.[key]
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string") {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : 0
  }
  return 0
}

function extractBackgroundPartText(part: BackgroundSessionMessagePartLike | undefined): string[] {
  if (!part || typeof part !== "object") {
    return []
  }

  if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string" && part.text.trim().length > 0) {
    return [part.text.trim()]
  }

  if (part.type !== "tool_result") {
    return []
  }

  if (typeof part.content === "string" && part.content.trim().length > 0) {
    return [part.content.trim()]
  }

  if (Array.isArray(part.content)) {
    const chunks = part.content.flatMap((block) => {
      if ((block?.type === "text" || block?.type === "reasoning") && typeof block.text === "string" && block.text.trim().length > 0) {
        return [block.text.trim()]
      }
      return []
    })
    if (chunks.length > 0) {
      return chunks
    }
  }

  if (typeof part.output === "string" && part.output.trim().length > 0) {
    return [part.output.trim()]
  }

  return []
}

export function extractBackgroundMessageText(message: BackgroundSessionMessageLike): string {
  const chunks = (message.parts ?? []).flatMap((part) => extractBackgroundPartText(part))
  return chunks.join("\n\n")
}

function hasMeaningfulBackgroundMessageOutput(message: BackgroundSessionMessageLike): boolean {
  return extractBackgroundMessageText(message).length > 0
}

function hasOnlyMetaAssistantParts(message: BackgroundSessionMessageLike): boolean {
  const parts = message.parts ?? []
  if (parts.length === 0) {
    return true
  }

  return parts.every((part) => {
    if (part?.type === "step-start" || part?.type === "step-finish") {
      return true
    }
    if ((part?.type === "text" || part?.type === "reasoning") && typeof part.text === "string") {
      return part.text.trim().length === 0
    }
    return false
  })
}

function hasTerminalAssistantFinish(message: BackgroundSessionMessageLike | undefined): boolean {
  const finish = message?.info?.finish
  return typeof finish === "string" && finish.trim().length > 0 && !BACKGROUND_NON_TERMINAL_FINISH_REASONS.has(finish)
}

export function analyzeBackgroundTaskMessages(messages: BackgroundSessionMessageLike[]) {
  const relevantMessages = messages.filter((message) => message.info?.role === "assistant" || message.info?.role === "tool")
  const sortedMessages = [...relevantMessages].sort((left, right) => getSessionMessageTimestamp(left, "created") - getSessionMessageTimestamp(right, "created"))
  const assistantMessages = sortedMessages.filter((message) => message.info?.role === "assistant")
  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  const lastMeaningfulAssistant = [...assistantMessages].reverse().find((message) => hasMeaningfulBackgroundMessageOutput(message))
  const hasValidOutput = sortedMessages.some((message) => hasMeaningfulBackgroundMessageOutput(message))
  const hasDanglingEmptyAssistantTail = !!(
    lastAssistant &&
    lastMeaningfulAssistant &&
    lastAssistant !== lastMeaningfulAssistant &&
    !lastAssistant.info?.finish &&
    hasOnlyMetaAssistantParts(lastAssistant) &&
    getSessionMessageTimestamp(lastMeaningfulAssistant, "completed") > 0
  )
  const finalAssistant = hasTerminalAssistantFinish(lastAssistant)
    ? (hasMeaningfulBackgroundMessageOutput(lastAssistant) ? lastAssistant : lastMeaningfulAssistant)
    : hasDanglingEmptyAssistantTail
      ? lastMeaningfulAssistant
      : lastMeaningfulAssistant

  return {
    relevantMessages,
    sortedMessages,
    assistantMessages,
    lastAssistant,
    lastMeaningfulAssistant,
    finalAssistant,
    hasValidOutput,
    hasTerminalAssistant: hasTerminalAssistantFinish(lastAssistant),
    hasDanglingEmptyAssistantTail,
  }
}

export function hasBackgroundSessionCompletionSignal(messages: BackgroundSessionMessageLike[]): boolean {
  const analysis = analyzeBackgroundTaskMessages(messages)
  return analysis.hasValidOutput && (analysis.hasTerminalAssistant || analysis.hasDanglingEmptyAssistantTail)
}
