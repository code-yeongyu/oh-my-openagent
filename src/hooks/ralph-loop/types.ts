import type { RalphLoopConfig } from "../../config"

export type RalphLoopMode = "standard" | "ulw" | "audit-loop"

export interface RalphLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_promise: string
  completion_detection_enabled?: boolean
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
  mode?: RalphLoopMode
  max_duration_ms?: number
  deadline_at?: string
  stop_reason?: "completed" | "max_iterations" | "timeout" | "cancelled" | "aborted"
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
}
