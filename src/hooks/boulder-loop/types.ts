import type { BoulderLoopConfig } from "../../config"

export interface BoulderLoopState {
  active: boolean
  iteration: number
  deadline: number
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
}

export interface BoulderLoopOptions {
  config?: BoulderLoopConfig
  checkSessionExists?: (sessionId: string) => Promise<boolean>
}
