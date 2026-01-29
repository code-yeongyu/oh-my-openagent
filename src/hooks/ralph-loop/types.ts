import type { RalphLoopConfig } from "../../config"
import type { AgentConfig } from "@opencode-ai/sdk"

export interface RalphLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_promise: string
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
  agentConfigs?: Record<string, AgentConfig> | (() => Record<string, AgentConfig>)
}
