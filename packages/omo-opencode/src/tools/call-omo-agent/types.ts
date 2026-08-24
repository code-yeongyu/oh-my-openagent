import type { ALLOWED_AGENTS } from "./constants"

export type AllowedAgentType = (typeof ALLOWED_AGENTS)[number]

export interface CallOmoAgentArgs {
  description: string
  prompt: string
  subagent_type: string
  run_in_background: boolean
  session_id?: string
  /** Orchestrator per-call model override, e.g. "openai/gpt-5.5" or "openai/gpt-5.5 xhigh". Gated to connected models. */
  model?: string
  /** Orchestrator per-call reasoning/variant override (e.g. "xhigh"); precedence over a variant inside `model`. */
  reasoning_effort?: string
}

export interface CallOmoAgentSyncResult {
  title: string
  metadata: {
    summary?: Array<{
      id: string
      tool: string
      state: {
        status: string
        title?: string
      }
    }>
    sessionId: string
  }
  output: string
}
export type ToolContextWithMetadata = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
}
