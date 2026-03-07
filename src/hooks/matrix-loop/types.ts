import type { MatrixLoopConfig } from "../../config"

export interface MatrixLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_promise: string
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
  verification_in_progress?: boolean
  verification_failed_count?: number
}

export interface MatrixLoopOptions {
  config?: MatrixLoopConfig
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
  verification?: {
    enabled?: boolean
    agent?: string
    timeoutMs?: number
    maxRetries?: number
  }
}
