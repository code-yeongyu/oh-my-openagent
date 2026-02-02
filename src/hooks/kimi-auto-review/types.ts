export interface KimiReviewConfig {
  enabled?: boolean
  model?: string
  blockOnCritical?: boolean
  reviewThreshold?: "all" | "code-only"
  extensions?: string[]
  ignorePatterns?: string[]
  timeoutMs?: number
}

export interface KimiReviewOptions {
  config?: KimiReviewConfig
}

export type ReviewSeverity = "CRITICAL" | "WARNING" | "STYLE"
export type ReviewVerdict = "APPROVED" | "ISSUES_FOUND"

export interface ReviewIssue {
  severity: ReviewSeverity
  message: string
  file?: string
  line?: number
  suggestion?: string
}

export interface KimiReviewResult {
  verdict: ReviewVerdict
  issues: ReviewIssue[]
  summary: string
  rawResponse?: string
}

export interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

export interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}
