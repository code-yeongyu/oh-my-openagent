import type { ALLOWED_AGENTS } from "./constants"

export type AllowedAgentType = (typeof ALLOWED_AGENTS)[number]

export interface OmoTaskArgs {
  description: string
  prompt: string
  subagent_type: string
  session_id?: string
}

export interface OmoTaskResult {
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
