const MEANINGFUL_ASSISTANT_PART_TYPES = new Set([
  "reasoning",
  "tool",
  "tool_use",
])

export type TailMonitorState = {
  currentMessageID?: string
  currentHasOutput: boolean
  consecutiveNoTextMessages: number
  lastCompactedAt?: number
  lastRecoveryAt?: number
}

export function finalizeTrackedAssistantMessage(
  state: TailMonitorState,
): number {
  if (!state.currentMessageID) {
    return state.consecutiveNoTextMessages
  }

  state.consecutiveNoTextMessages = state.currentHasOutput
    ? 0
    : state.consecutiveNoTextMessages + 1
  state.currentMessageID = undefined
  state.currentHasOutput = false

  return state.consecutiveNoTextMessages
}

export function shouldTreatAssistantPartAsOutput(part: {
  type?: string
  text?: string
}): boolean {
  if (part.type === "text") {
    return !!part.text?.trim()
  }

  return typeof part.type === "string" && MEANINGFUL_ASSISTANT_PART_TYPES.has(part.type)
}

export function trackAssistantOutput(
  state: TailMonitorState,
  messageID?: string,
): void {
  if (messageID && !state.currentMessageID) {
    state.currentMessageID = messageID
  }

  state.currentHasOutput = true
  state.consecutiveNoTextMessages = 0
}
