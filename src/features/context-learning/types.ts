/**
 * Context Learning Types
 *
 * Data models for session learning extraction and chat quality review.
 * Part of LIF-73: Self-Improving Session Learning & Chat Review System
 */

/**
 * Evidence supporting a learning candidate
 */
export interface LearningEvidence {
  type: "file" | "tool_output" | "decision_point"
  source: string // File path or tool name
  context?: string // Brief context
  excerpt: string // Max 200 chars
  lineRange?: string // e.g., "45-52"
}

/**
 * Category for learning candidates
 */
export type LearningCategory = "constitution" | "architecture" | "tech-stack" | "glossary" | "decision"

/**
 * Meta-learning category for OmO improvement (LIF-73 Part B)
 */
export type MetaLearningCategory =
  | "agent_instructions"
  | "commands"
  | "orchestration"
  | "context_handling"
  | "tool_usage"

/**
 * A learning candidate extracted from a session
 */
export interface LearningCandidate {
  title: string // Short description
  claim: string // General rule/pattern
  category: LearningCategory
  scope: string // When this applies
  confidence: number // 0-1 score
  status: "pending" | "approved" | "rejected"
  evidence: LearningEvidence[]
  rationale: string // Why this is a learning
}

/**
 * Trigger for learning extraction
 */
export type LearningTrigger = "idle" | "compacted"

/**
 * Cost tracking for API calls
 */
export interface CostTracking {
  inputTokens: number
  outputTokens: number
  estimatedUsd: number
}

/**
 * Metadata for a learning candidates file
 */
export interface LearningCandidatesMetadata {
  sessionId: string
  timestamp: string // ISO 8601
  signalScore: number // 0-10
  filesModified: string[]
  toolsUsed: string[]
  trigger: LearningTrigger
}

/**
 * Notes from extraction process
 */
export interface ExtractionNotes {
  totalCandidates: number
  highConfidence: number // >0.8
  mediumConfidence: number // 0.5-0.8
  lowConfidence: number // <0.5
  vetoTriggers: string[]
  cost: CostTracking
}

/**
 * Complete learning candidates file structure
 */
export interface LearningCandidatesFile {
  metadata: LearningCandidatesMetadata
  candidates: LearningCandidate[]
  extractionNotes: ExtractionNotes
}

/* --- Chat Review Types --- */

/**
 * Improvement category
 */
export type ImprovementCategory = "Hook" | "Prompt" | "Rule" | "Tool" | "Workflow" | "Docs"

/**
 * Effort level for improvements
 */
export type EffortLevel = "Quick" | "Short" | "Medium" | "Large"

/**
 * An improvement suggestion from chat review
 */
export interface Improvement {
  id: string // e.g., "H1", "M1", "L1"
  category: ImprovementCategory
  issue: string // What's wrong
  suggestedFix: string // How to fix it
  effort: EffortLevel
  linearIssueId?: string // If created
}

/**
 * Score for a single dimension
 */
export interface DimensionScore {
  score: number // 1-10
  notes: string // Brief justification
}

/**
 * Six-point quality framework scores
 */
export interface QualityDimensions {
  taskCompletion: DimensionScore
  agentUtilization: DimensionScore
  toolEfficiency: DimensionScore
  workflowAdherence: DimensionScore
  errorHandling: DimensionScore
  contextManagement: DimensionScore
}

/**
 * Improvements grouped by priority
 */
export interface ImprovementsByPriority {
  high: Improvement[]
  medium: Improvement[]
  low: Improvement[]
}

/**
 * Excerpt type
 */
export type ExcerptType = "anti-pattern" | "good-pattern"

/**
 * Key excerpt from the review
 */
export interface KeyExcerpt {
  type: ExcerptType
  dimension: string
  excerpt: string
  betterApproach?: string
}

/**
 * Review history entry
 */
export interface ReviewHistoryEntry {
  reviewedAt: string // ISO 8601
  trigger: string
  newFindings: number
  keyInsight: string
}

/**
 * Context usage information
 */
export interface ContextUsage {
  percentage: number
  used: number
  limit: number
}

/**
 * Review status
 */
export type ReviewStatus = "draft" | "processed"

/**
 * Metadata for a review file
 */
export interface ReviewMetadata {
  sessionId: string
  model: string
  contextUsage: ContextUsage
  messageCount: number
  firstReviewed: string // ISO 8601
  lastUpdated: string // ISO 8601
  reviewCount: number
  status: ReviewStatus
  processedAt?: string // ISO 8601
}

/**
 * Complete review file structure
 */
export interface ReviewFile {
  metadata: ReviewMetadata
  qualityScore: number // 1-10 (weighted average)
  executiveSummary: string // 2-3 sentences
  dimensionScores: QualityDimensions
  improvements: ImprovementsByPriority
  keyExcerpts: KeyExcerpt[]
  reviewHistory?: ReviewHistoryEntry[]
  cost: CostTracking
}

/* --- Transcript Types --- */

/**
 * Role in conversation
 */
export type MessageRole = "user" | "assistant"

/**
 * Tool call in a message
 */
export interface ToolCall {
  tool: string
  args: Record<string, unknown>
  result?: string // Truncated if large
}

/**
 * A single transcript message (JSONL format)
 */
export interface TranscriptMessage {
  role: MessageRole
  content: string
  timestamp: string // ISO 8601
  model?: string // For assistant messages
  toolCalls?: ToolCall[]
}

/* --- Signal Scoring Types --- */

/**
 * Strong signal names (3 points each)
 */
export type StrongSignalName =
  | "edited_memory_files"
  | "created_shared_utilities"
  | "architectural_decisions"
  | "cross_file_refactoring"

/**
 * Medium signal names (2 points each)
 */
export type MediumSignalName = "decision_language" | "pattern_identification" | "cross_file_impact"

/**
 * Weak signal names (1 point each)
 */
export type WeakSignalName = "new_file_types" | "config_changes" | "dependency_changes"

/**
 * Veto condition names
 */
export type VetoConditionName = "single_file_change" | "environment_specific" | "speculation"

/**
 * A signal detection result
 */
export interface SignalDetection<T extends string> {
  name: T
  detected: boolean
  evidence?: string[]
  reason?: string
}

/**
 * Multi-signal scoring result
 */
export interface SignalScoring {
  strongSignals: SignalDetection<StrongSignalName>[]
  mediumSignals: SignalDetection<MediumSignalName>[]
  weakSignals: SignalDetection<WeakSignalName>[]
  vetoConditions: SignalDetection<VetoConditionName>[]
  totalScore: number // 0-10
  threshold: number // From config (default: 3)
  shouldTrigger: boolean // totalScore >= threshold AND no vetoes
}

/* --- Hook State Types --- */

/**
 * State for a single session in the hook
 */
export interface SessionLearningState {
  inFlight: boolean
  lastExtractedHash: string
  lastExtractTime: Date
}

/**
 * Hook state map (sessionId -> state)
 */
export type HookStateMap = Map<string, SessionLearningState>

/* --- Configuration Types --- */

/**
 * Configuration for context learning feature
 */
export interface ContextLearningConfig {
  enabled: boolean
  signalThreshold: number // Default: 3
  cooldownMinutes: number // Default: 30
  maxCandidatesPerSession: number // Default: 3
  minConfidence: number // Default: 0.5
  autoPromoteThreshold: number // Default: 0.9 (auto-approve if confidence >= this)
  dailyBudgetUsd: number // Default: 1.0
  storagePath: string // Default: "context/"
}

/**
 * Configuration for chat review feature
 */
export interface ChatReviewConfig {
  enabled: boolean
  saveTranscriptsByDefault: boolean // Default: false
  maxExcerptLength: number // Default: 200
  storagePath: string // Default: "context/"
}

/**
 * Combined context learning and review config
 */
export interface ContextLearningFeatureConfig {
  learning: ContextLearningConfig
  review: ChatReviewConfig
}

/* --- Utility Types --- */

/**
 * Result of file write operation
 */
export interface FileWriteResult {
  success: boolean
  path: string
  error?: string
}

/**
 * Result of secret redaction
 */
export interface RedactionResult {
  redacted: string
  secretsFound: number
  secretTypes: string[]
}

/**
 * Result of anti-bloat check
 */
export interface AntiBloatResult {
  passed: boolean
  reason?: string
  duplicates?: string[]
  suggestions?: string[]
}
