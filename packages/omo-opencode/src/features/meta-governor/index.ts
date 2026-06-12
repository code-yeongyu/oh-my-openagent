/**
 * MetaGovernor — self-judging agent orchestration layer.
 *
 * PR 1 of v2 series. This barrel re-exports ONLY the type surface.
 * Runtime modules (memory-aggregator, scoring-engine, orchestrator, etc.)
 * are added in subsequent PRs.
 *
 * Architectural invariants:
 * - All session.promptAsync calls go through prompt-async-gate
 * - Composes agentmemory + magic-context + boulder-state
 * - Feature flag `meta_governor.enabled = false` default
 */
export type {
  Decision,
  DecisionContext,
  DecisionHandlerConfig,
  DecisionHandlerInput,
  DecisionHandlerOutput,
  Deviation,
  EscalationTarget,
  Evidence,
  EvidenceContribution,
  EvidenceSource,
  LearnFromOutcomeInput,
  LearnFromOutcomeOutput,
  LessonLearned,
  MemoryDecision,
  MemoryRead,
  AgentMemoryRead,
  MagicContextRead,
  BoulderStateRead,
  MemorySource,
  AmbientContext,
  MetaGovernorInput,
  MetaGovernorOutput,
  OrchestratorConfig,
  RelevantLesson,
  ScoringConfig,
  ScoringResult,
  SlotMemory,
  ClosedLoopConfig,
  TokenPrediction,
  TokenRecommendation,
  TokenPredictorConfig,
  TokenPredictorInput,
  TokenPredictorOutput,
  AgentmemoryWriteBackend,
  MemoryBackends,
} from "./types"

// PR 6: decision-handler (map score → action + message)
export {
  handleDecision,
  defaultDecisionHandlerConfig,
  trimHistory,
  countConsecutiveStops,
} from "./decision-handler"
