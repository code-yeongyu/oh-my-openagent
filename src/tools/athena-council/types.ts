export interface AthenaCouncilToolArgs {
  question: string
  members?: string[]
}

export interface AthenaCouncilToolContext {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void | Promise<void>
  callID?: string
}
