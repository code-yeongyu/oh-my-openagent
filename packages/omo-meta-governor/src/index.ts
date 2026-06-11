import type { PluginModule } from "@opencode-ai/plugin"
import { createMetaGovernorPlugin } from "./plugin"

/**
 * @sisyphuslabs/omo-meta-governor — Self-judging agent orchestration layer.
 *
 * Default export is an OpenCode PluginModule that registers a
 * `tool.execute.after` hook. The MetaGovernor reads session signals,
 * scores them against weighted evidence, and dispatches decisions.
 *
 * Install:
 *   npm install @sisyphuslabs/omo-meta-governor
 *
 * Configure:
 * ```jsonc
 * {
 *   "meta_governor": {
 *     "enabled": true
 *   }
 * }
 * ```
 */
const pluginModule: PluginModule = {
  id: "omo-meta-governor",
  server: createMetaGovernorPlugin(),
}

export default pluginModule

export {
  createMetaGovernorPlugin,
  type MetaGovernorPluginDeps,
} from "./plugin"

export {
  runMetaGovernor,
  buildDecisionContext,
  defaultOrchestratorConfig,
} from "./orchestrator"
export {
  loadOrchestratorConfig,
  isMetaGovernorEnabled,
  type MetaGovernorPluginConfig,
} from "./config"

// Core module re-exports
export { score, defaultScoringConfig } from "./scoring-engine"
export { predict, defaultTokenPredictorConfig, calculateBurnRate } from "./token-predictor"
export { handleDecision, defaultDecisionHandlerConfig, trimHistory, countConsecutiveStops } from "./decision-handler"
export { observeAndLearn, defaultClosedLoopConfig } from "./closed-loop-learning"
export { aggregateRead } from "./memory-aggregator"
export { recordRecovery, type RecoveryOutcome } from "./post-repair-recorder"

// Types
export type {
  Decision,
  DecisionContext,
  DecisionHandlerConfig,
  DecisionHandlerInput,
  DecisionHandlerOutput,
  Deviation,
  Evidence,
  EvidenceContribution,
  LearnFromOutcomeInput,
  LearnFromOutcomeOutput,
  MemoryRead,
  MemoryBackends,
  AgentmemoryWriteBackend,
  MetaGovernorInput,
  MetaGovernorOutput,
  OrchestratorConfig,
  ScoringConfig,
  ScoringResult,
  SlotMemory,
  TokenPredictorConfig,
  TokenPredictorInput,
  TokenPredictorOutput,
  ClosedLoopConfig,
} from "./types"
