import type { ConstraintViolation, KnowledgeCommit, Severity } from "../../features/knowledge-repo/types"

export interface MonitorContext {
  projectRoot: string
  sessionId: string
  toolName: string
  callId: string
}

export interface PendingToolCall {
  context: MonitorContext
  filePath?: string
  content?: string
  oldString?: string
  newString?: string
  edits?: Array<{ old_string: string; new_string: string }>
  command?: string
  timestamp: number
}

export interface ViolationReport {
  violations: ConstraintViolation[]
  highestSeverity: Severity
  message: string
  shouldBlock: boolean
  relatedKnowledge: KnowledgeCommit[]
}

export interface KnowledgeMonitorConfig {
  enabled?: boolean
  repositoryRoot?: string
  checkPreTool?: boolean
  checkPostTool?: boolean
  blockOnViolation?: boolean
  ignorePaths?: string[]
}

export interface InterruptionDecision {
  shouldInterrupt: boolean
  shouldBlock: boolean
  message: string
  violations: ConstraintViolation[]
}
