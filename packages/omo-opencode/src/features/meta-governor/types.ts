/**
 * MetaGovernor type contracts.
 *
 * PR 1 of 8. Defines ONLY the type surface that later PRs implement against.
 * No logic, no I/O, no MCP calls. This file is the source of truth for the
 * MetaGovernor architecture; later PRs import these types and conform to them.
 *
 * Architectural invariants (from AGENTS.md, must respect):
 * - All session.promptAsync calls go through prompt-async-gate (not enforced here)
 * - MetaGovernor composes AFT + agentmemory + magic-context + boulder-state
 * - 5 recovery hooks wrap into post-repair-recorder (not enforced here)
 *
 * Public surface (5 contracts):
 * - DecisionContext: input to score()
 * - Decision: output of score()
 * - Evidence: atomic evidence unit attached to a Decision
 * - MemoryRead: cross-system read result
 * - TokenPrediction: token burn rate prediction
 *
 * All enums/actions are union string types (no enums) for Zod compat and
 * JSON-serialisability across the prompt-async-gate.
 */

/**
 * What the judge sees when deciding continue|warn|escalate|stop.
 *
 * All fields are required. `undefined` is not a valid DecisionContext —
 * collectors must fill every field even if the value is an empty array,
 * false, or 0. Empty inputs are signals, not bugs.
 */
export interface DecisionContext {
  /** Whether the last Oracle invocation returned verified=true. */
  readonly oracleVerified: boolean
  /** Whether the last assistant turn produced no progress (zero tokens, no content). */
  readonly noProgress: boolean
  /** Detected deviations from expected behavior. Empty array = no deviations. */
  readonly deviations: readonly Deviation[]
  /** iteration / maxIterations. 0..1. 1.0 = at the cap. */
  readonly iterationRatio: number
  /** Lessons retrieved from agentmemory that match the current decision pattern. */
  readonly lessonsRelevant: readonly RelevantLesson[]
  /** Cross-session memory snapshot from the meta_state slot. */
  readonly slotMemory: SlotMemory
  /** Free-form context the calling site can attach (sessionID, directory, mode). */
  readonly ambient: AmbientContext
}

/**
 * Decision the judge returns. Always carries evidence (cite-or-abstain).
 *
 * Score ∈ [-1, +1]:
 *   >= +0.3 → continue silently
 *   -0.3..+0.3 → continue with log
 *   -0.6..-0.3 → continue with warn
 *   -0.8..-0.6 → escalate (oracle or user)
 *   < -0.8 → stop loop
 *
 * Note: actual thresholds are config-driven in PR 8. Defaults are above.
 */
export interface Decision {
  readonly action: "continue" | "warn" | "escalate" | "stop"
  readonly score: number
  /** Human-readable one-sentence explanation. Required, never empty. */
  readonly reasoning: string
  /** Cite-or-abstain: at least 1 evidence unit when action !== "continue" silently. */
  readonly evidence: readonly Evidence[]
  /** When action === "escalate", which actor should be invoked. */
  readonly shouldEscalateTo: EscalationTarget | null
}

export type EscalationTarget = "oracle" | "user"

/**
 * Atomic evidence unit. Carries provenance so the judge can be audited.
 *
 * `confidence` ∈ [0, 1]: how sure the source is about `value`.
 * `weight` ∈ [0, 1]: how much this evidence influences the score
 *  (assigned by the scoring function, not the collector).
 */
export interface Evidence {
  readonly source: EvidenceSource
  readonly value: string
  readonly confidence: number
  readonly weight: number
}

export type EvidenceSource =
  | "oracle-verified"
  | "no-progress-detector"
  | "deviation-detector"
  | "iteration-budget"
  | "lesson-recall"
  | "slot-memory"
  | "ambient"
  | "token-predictor"

/**
 * A deviation from expected behavior. Severity follows the prior
 * moderator-gate (PR 4405) taxonomy for backward compat.
 */
export interface Deviation {
  readonly severity: "leve" | "media" | "grave"
  readonly category: string
  readonly detail: string
  readonly filePath?: string
}

/**
 * A lesson retrieved from agentmemory.lesson_recall. Confidence is the
 * stored confidence in the memory store, not the relevance to this query.
 */
export interface RelevantLesson {
  readonly id: string
  readonly title: string
  readonly advice: "continue" | "stop" | "warn" | "info"
  readonly confidence: number
  readonly concepts: readonly string[]
}

/**
 * Cross-session state held in the magic-context `meta_state` slot.
 *
 * `consecutiveStops` is read by the judge to detect paralysis (3 stops
 * in a row → force continue with warning, prevents infinite conservatism).
 */
export interface SlotMemory {
  readonly lastDecision?: Decision
  readonly consecutiveStops: number
  readonly consecutiveContinues: number
  readonly lastUpdatedISO: string
}

/**
 * Free-form context the calling site can attach. Used for audit trails
 * and to enable the judge to factor in mode (ultrawork vs simple) or
 * session state. Fields are optional to keep the contract lean.
 */
export interface AmbientContext {
  readonly sessionID: string
  readonly directory: string
  readonly mode: "ultrawork" | "ulw" | "simple" | "ralph-loop"
  readonly agentName: string
  readonly iteration: number
  readonly maxIterations: number
}

/**
 * Cross-system memory read result. All three sources read in parallel;
 * any of them may be unavailable (graceful degradation in PR 2).
 *
 * `query` is echoed back so callers can correlate the read with the
 * query that produced it.
 */
export interface MemoryRead {
  readonly query: string
  readonly timestampISO: string
  readonly agentmemory: AgentMemoryRead
  readonly magicContext: MagicContextRead
  readonly boulderState: BoulderStateRead
  readonly degradedSources: readonly MemorySource[]
}

export type MemorySource = "agentmemory" | "magicContext" | "boulderState"

export interface AgentMemoryRead {
  readonly available: boolean
  readonly lessons: readonly RelevantLesson[]
  readonly errorMessage?: string
}

export interface MagicContextRead {
  readonly available: boolean
  readonly slots: readonly { readonly label: string; readonly content: string }[]
  readonly errorMessage?: string
}

export interface BoulderStateRead {
  readonly available: boolean
  readonly tasks: readonly { readonly id: string; readonly status: string; readonly title: string }[]
  readonly planProgress: number
  readonly errorMessage?: string
}

/**
 * Token burn rate prediction. Computed from recent turn metrics.
 *
 * `willOverflowAt` is an ISO timestamp predicted from current usage +
 * burn rate + model limit. `null` when not expected to overflow.
 *
 * `recommendation` is action-typed; the caller (PR 7 integration) maps
 * these to actual hook invocations:
 *   - "compact-now" → invoke preemptive-compaction-degradation-monitor
 *   - "switch-model" → invoke model-fallback chat-message-fallback-handler
 *   - "delegate-to-subagent" → invoke delegate-task with a sub-scope
 *   - "no-action" → silent
 */
export interface TokenPrediction {
  readonly currentUsage: number
  readonly burnRate: number
  readonly budgetLeft: number
  readonly willOverflowAt: string | null
  readonly recommendation: TokenRecommendation
  readonly confidence: number
  readonly modelLimit: number
  readonly windowRemaining: number
}

export type TokenRecommendation =
  | "compact-now"
  | "switch-model"
  | "delegate-to-subagent"
  | "no-action"

/**
 * Closed-loop learning types. PR 3 of 8.
 *
 * After every repair/action cycle, observeAndLearn() decides whether to
 * persist a lesson or decision record to agentmemory. Future sessions
 * retrieve these via aggregateRead() (PR 2) and factor them into
 * scoring (PR 5).
 */

/**
 * Configuration for the closed-loop learning system.
 */
export interface ClosedLoopConfig {
  /** Master switch. false = observe only, never write. */
  readonly enabled: boolean
  /** Minimum severity to trigger a lesson write. */
  readonly minSeverityToLearn: "leve" | "media" | "grave"
  /** Maximum lessons to save per session (prevents flooding). Default 20. */
  readonly maxLessonsPerSession: number
  /** Whether to save decision records (lighter than lessons). Default true. */
  readonly saveDecisions: boolean
}

/**
 * A record of a decision that was made, saved to agentmemory for future retrieval.
 */
export interface MemoryDecision {
  readonly id: string
  readonly timestampISO: string
  readonly action: Decision["action"]
  readonly score: number
  readonly reasoning: string
  readonly sessionID: string
  readonly directory: string
  readonly deviations: readonly Deviation[]
}

/**
 * A lesson extracted from an outcome, saved to agentmemory.
 */
export interface LessonLearned {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly type: "pattern" | "bug" | "architecture" | "workflow"
  readonly concepts: readonly string[]
  readonly confidence: number
  readonly files: readonly string[]
  readonly sessionID: string
}

/**
 * Interface for writing to agentmemory. DI pattern — same as AgentmemoryBackend for reads.
 * The real implementation calls agentmemory_memory_save / agentmemory_memory_lesson_save via MCP.
 */
export interface AgentmemoryWriteBackend {
  saveMemory(input: {
    content: string
    concepts: string[]
    type: string
    files?: string[]
  }): Promise<{ id: string }>

  saveLesson(input: {
    content: string
    context: string
    confidence?: number
    tags?: string[]
  }): Promise<{ id: string }>
}

/** Backend interfaces for memory-aggregator DI. Re-uses existing BoulderStateBackend from memory-aggregator. */
export interface OrchestratorAgentmemoryBackend {
  smartSearch(input: {
    query: string
    limit?: number
  }): Promise<{ lessons: Array<{ title: string; content: string; type: string; confidence: number }>; crystals: unknown[] }>
}

export interface OrchestratorMagicContextBackend {
slotList(input: { directory?: string; labelPrefix?: string }): Promise<Array<{ label: string; content: string }>>
}

export interface OrchestratorBoulderStateBackend {
  boulderRead(input: { directory: string; sessionID: string; query?: string }): Promise<Array<{ id: string; title: string; priority: number; status: string; createdAtMs: number; updatedAtMs: number }>>
}

export interface MemoryBackends {
  agentmemory: OrchestratorAgentmemoryBackend
  magicContext: OrchestratorMagicContextBackend
  boulderState: OrchestratorBoulderStateBackend
}

/**
 * Input to observeAndLearn(). Carries everything the learning function needs
 * to decide WHAT to learn and WHETHER to learn it.
 */
export interface LearnFromOutcomeInput {
  readonly decision: Decision
  readonly memoryRead: MemoryRead
  readonly config: ClosedLoopConfig
  readonly sessionID: string
  readonly directory: string
  readonly filesChanged: readonly string[]
}

/**
 * Output from observeAndLearn(). Reports what was persisted (if anything).
 */
export interface LearnFromOutcomeOutput {
  readonly lessonSaved: LessonLearned | null
  readonly decisionSaved: MemoryDecision | null
  readonly reason: string
}

/**
 * Token Predictor types. PR 4 of 8.
 *
 * Computes token burn rate from recent turn metrics and recommends
 * preemptive actions (compact, switch model, delegate) before context
 * window exhaustion.
 */

export interface TokenPredictorConfig {
  /** Burn rate threshold (tokens/sec) above which to recommend compact-now. Default: 500. */
  readonly compactBurnRateThreshold: number
  /** Context usage ratio (0..1) above which to recommend compact-now. Default: 0.85. */
  readonly compactUsageThreshold: number
  /** Context usage ratio above which to recommend switch-model. Default: 0.95. */
  readonly switchModelUsageThreshold: number
  /** Max consecutive high-burn turns before recommending delegate. Default: 5. */
  readonly delegateConsecutiveHighBurn: number
  /** Number of recent turns to use for burn rate calculation. Default: 10. */
  readonly windowSize: number
}

export interface TokenPredictorInput {
  readonly currentUsage: number
  readonly modelLimit: number
  readonly recentTurnTokens: readonly number[]
  readonly timestampISO: string
  readonly providerID: string
  readonly modelID: string
  readonly config: TokenPredictorConfig
}

export interface TokenPredictorOutput extends TokenPrediction {
  readonly input: TokenPredictorInput
  readonly computedAtISO: string
  readonly turnsAnalyzed: number
}

/**
 * Scoring Engine types. PR 5 of 8.
 *
 * Configuration for the weighted evidence scoring system that maps
 * a DecisionContext to a Decision. Thresholds are configurable; defaults
 * match the Decision contract in types.ts (lines 50-59).
 */

export interface ScoringConfig {
  /** Score >= this → continue silently. Default: 0.3. */
  readonly continueThreshold: number
  /** Score in [-warnThreshold, +warnThreshold] → continue with log. Default: 0.3. */
  readonly warnThreshold: number
  /** Score <= -warnThreshold && > -escalateThreshold → warn. Default: 0.6. */
  readonly escalateThreshold: number
  /** Score <= -escalateThreshold && > -stopThreshold → escalate. Default: 0.8. */
  readonly stopThreshold: number
  /** Number of consecutive stops that triggers paralysis override. Default: 3. */
  readonly paralysisThreshold: number
  /** Default escalation target when action is escalate. Default: "oracle". */
  readonly defaultEscalationTarget: EscalationTarget
}

/**
 * Weighted evidence contribution for a single signal.
 */
export interface EvidenceContribution {
  readonly source: EvidenceSource
  readonly rawScore: number
  readonly weight: number
  readonly weightedScore: number
  readonly description: string
}

/**
 * Full scoring result with per-signal breakdown.
 */
export interface ScoringResult {
  readonly decision: Decision
  readonly contributions: readonly EvidenceContribution[]
  readonly rawScore: number
  readonly paralysisOverride: boolean
  readonly computedAtISO: string
}

// ─── Decision Handler Types (PR 6) ────────────────────────────────

export interface DecisionHandlerConfig {
  /** Master switch: false = always continue (pass-through) */
  readonly enabled: boolean
  /** Max history entries per session before oldest are trimmed */
  readonly maxHistoryPerSession: number
  /** How many consecutive stops before forcing continue */
  readonly forceContinueAfterStops: number
  /** Template for warn messages. Placeholders: {score}, {reasoning}, {evidenceCount} */
  readonly warnMessageTemplate: string
  /** Template for escalation messages. Placeholders: {target}, {reasoning} */
  readonly escalateMessageTemplate: string
  /** Template for stop messages. Placeholders: {reasoning}, {evidenceCount} */
  readonly stopMessageTemplate: string
  /** Default escalation target when Decision.shouldEscalateTo is null */
  readonly defaultEscalationTarget?: string
}

export interface DecisionHandlerInput {
  readonly scoringResult: ScoringResult
  readonly sessionID: string
}

export interface DecisionHistoryEntry {
  readonly decision: Decision
  readonly action: "continue" | "warn" | "escalate" | "stop"
  readonly timestampISO: string
  readonly sessionID: string
  readonly reasoning: string
}

export interface DecisionHandlerOutput {
  readonly action: "continue" | "warn" | "escalate" | "stop"
  readonly message: string | null
  readonly historyEntry: DecisionHistoryEntry
}

// ─── Orchestrator Types (PR 7) ────────────────────────────────────

/**
 * Configuration for the orchestrator. Each sub-config overrides the
 * corresponding module's defaults. The orchestrator merges these onto
 * the per-module defaults at init time.
 */
export interface OrchestratorConfig {
  /** Master switch. false = skip all MetaGovernor processing. */
  readonly enabled: boolean
  /** Memory aggregator config. */
  readonly memory: {
    readonly enabled: boolean
    readonly query: string
    readonly timeoutMs?: number
  }
  /** Token predictor config overrides. */
  readonly tokenPredictor: Partial<TokenPredictorConfig>
  /** Scoring config overrides. */
  readonly scoring: Partial<ScoringConfig>
  /** Decision handler config overrides. */
  readonly decision: Partial<DecisionHandlerConfig>
  /** Closed-loop learning config overrides. */
  readonly closedLoop: Partial<ClosedLoopConfig>
  /** Model override — when set, use a different model than the session. */
  readonly modelOverride?: {
    readonly providerID?: string
    readonly modelID?: string
    readonly modelLimit?: number
  }
}

/**
 * Input to runMetaGovernor(). All signals the orchestrator needs to
 * build a DecisionContext and dispatch a decision.
 */
export interface MetaGovernorInput {
  readonly sessionID: string
  readonly toolName: string
  readonly toolInput?: unknown
  readonly toolOutput?: unknown
  readonly agentName?: string
  readonly providerID?: string
  readonly modelID?: string
  readonly iteration: number
  readonly maxIterations: number
  readonly oracleVerified: boolean
  readonly noProgress: boolean
  readonly filesChanged: number
  readonly recentTurnTokens: readonly number[]
  readonly deviations: readonly Deviation[]
  readonly consecutiveStops?: number
  readonly backends: MemoryBackends
  readonly writeBackend: AgentmemoryWriteBackend
  readonly config?: Partial<OrchestratorConfig>
}

/**
 * Output from runMetaGovernor(). Contains all intermediate results
 * so the caller can log, inject messages, or escalate.
 */
export interface MetaGovernorOutput {
  readonly memoryRead: MemoryRead
  readonly tokenPrediction: TokenPredictorOutput
  readonly scoringResult: ScoringResult
  readonly decision: DecisionHandlerOutput
  readonly lessonSaved: LearnFromOutcomeOutput | null
  readonly decisionHistory: readonly DecisionHistoryEntry[]
  readonly skipped: boolean
  readonly skipReason?: string
}
