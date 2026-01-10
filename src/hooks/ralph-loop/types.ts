import type { RalphLoopConfig } from "../../config"
import type { TokenTracker } from "../../features/observability/TokenTracker"
import type { DecisionJournal } from "../../features/observability/DecisionJournal"
import type { SemanticMemory } from "../../features/semantic-memory"

export interface RalphLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_promise: string
  started_at: string
  prompt: string
  session_id?: string
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
  tokenTracker?: TokenTracker
  decisionJournal?: DecisionJournal
  semanticMemory?: SemanticMemory
}
