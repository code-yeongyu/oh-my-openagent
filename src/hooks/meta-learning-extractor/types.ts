import type {
  SignalScoring,
  SessionLearningState,
  MetaLearningCategory,
} from "../../features/context-learning/types"

export type MetaLearningTrigger =
  | "pre_compaction"
  | "idle"
  | "manual"

export interface MetaLearningExtractorConfig {
  enabled: boolean
  signalThreshold: number
  cooldownMinutes: number
  idleDebounceMs: number
  maxCandidatesPerSession: number
  minConfidence: number
  dailyBudgetUsd: number
  storagePath: string
}

export const DEFAULT_CONFIG: MetaLearningExtractorConfig = {
  enabled: true,
  signalThreshold: 3,
  cooldownMinutes: 30,
  idleDebounceMs: 5000,
  maxCandidatesPerSession: 3,
  minConfidence: 0.5,
  dailyBudgetUsd: 1.0,
  storagePath: "context/learnings/",
}

export interface ExtractorInput {
  sessionId: string
  messages: Array<{
    role: "user" | "assistant"
    content: string
    toolCalls?: Array<{
      tool: string
      args: Record<string, unknown>
      result?: string
    }>
  }>
  filesModified: string[]
  toolsUsed: string[]
  trigger: MetaLearningTrigger
}

export interface MetaLearningCandidate {
  title: string
  claim: string
  category: MetaLearningCategory
  scope: string
  confidence: number
  status: "pending" | "approved" | "rejected"
  evidence: Array<{
    type: "file" | "tool_output" | "conversation" | "pattern"
    source: string
    context?: string
    excerpt: string
  }>
  suggestedImprovement: string
  affectedFiles?: string[]
}

export interface MetaLearningFileMetadata {
  sessionId: string
  timestamp: string
  signalScore: number
  trigger: MetaLearningTrigger
  filesModified: string[]
  toolsUsed: string[]
}

export interface MetaLearningExtractionNotes {
  totalCandidates: number
  highConfidence: number
  mediumConfidence: number
  lowConfidence: number
  cost: {
    inputTokens: number
    outputTokens: number
    estimatedUsd: number
  }
}

export interface MetaLearningFile {
  metadata: MetaLearningFileMetadata
  candidates: MetaLearningCandidate[]
  extractionNotes: MetaLearningExtractionNotes
}

export interface ExtractionResult {
  success: boolean
  path?: string
  candidateCount?: number
  error?: string
}

export interface HookState {
  sessions: Map<string, SessionLearningState>
  dailySpendUsd: number
  lastResetDate: string
}

export { SignalScoring }
