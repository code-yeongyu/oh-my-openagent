export interface EventState {
  mainSessionIdle: boolean
  mainSessionError: boolean
  lastError: string | null
  lastOutput: string
  lastPartText: string
  currentTool: string | null
  /** Set to true when the main session has produced meaningful work (text, tool call, or tool result) */
  hasReceivedMeaningfulWork: boolean
  /** Count of assistant messages for the main session */
  messageCount: number
}

export function createEventState(): EventState {
  return {
    mainSessionIdle: false,
    mainSessionError: false,
    lastError: null,
    lastOutput: "",
    lastPartText: "",
    currentTool: null,
    hasReceivedMeaningfulWork: false,
    messageCount: 0,
  }
}
