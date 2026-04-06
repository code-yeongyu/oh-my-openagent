export type WorkflowPhase =
  | "idle"
  | "planning"
  | "reviewing"
  | "executing"
  | "deploying"
  | "testing"
  | "completed"
  | "failed"

export type ReviewVerdict = "APPROVE" | "REJECT" | "CONDITIONAL" | null

export interface WorkflowState {
  phase: WorkflowPhase
  lastUpdated: string
  planFile?: string
  reviewFile?: string
  buildReportFile?: string
  testReportFile?: string
  review?: {
    verdict: ReviewVerdict
    score: number
    maxScore: number
    criticalIssues: string[]
  }
  build?: {
    success: boolean
    errors: string[]
  }
  deployment?: {
    success: boolean
    serverUrl?: string
    checkpointFile?: string
  }
  test?: {
    passed: boolean
    failedFlows: string[]
  }
  error?: {
    phase: WorkflowPhase
    message: string
    timestamp: string
  }
  reviewIterations: number
}
