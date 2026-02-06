export interface ReviewLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_promise: string
  started_at: string
  prompt: string
  session_id?: string
  target_branch: string
  pr_files: string[]
}

export interface ReviewLoopOptions {
  config?: unknown
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
}
