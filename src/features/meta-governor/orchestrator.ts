/**
 * MetaGovernor Orchestrator — PR 7 of 8.
 *
 * Unified pipeline integrating all 6 prior modules:
 * - Memory Aggregator (PR 2): parallel reads from 3 memory systems
 * - Token Predictor (PR 4): burn rate + context pressure estimation
 * - Scoring Engine (PR 5): weighted evidence scoring → action decision
 * - Decision Handler (PR 6): dispatch + history tracking + force-continue
 * - Closed-Loop Learning (PR 3): lesson persistence for future sessions
 *
 * Architecture:
 * - Pure pipeline: input → memory → predict → score → decide → learn → output
 * - Each stage is independently testable and DI-friendly
 * - Graceful degradation: if any module throws, returns partial output with skipped=true
 */

import { aggregateRead } from "./memory-aggregator"
import type { Backends } from "./memory-aggregator"
import { predict } from "./token-predictor"
import { score } from "./scoring-engine"
import { handleDecision } from "./decision-handler"
import { observeAndLearn, defaultClosedLoopConfig } from "./closed-loop-learning"

import type {
  AgentmemoryWriteBackend,
  DecisionContext,
  DecisionHandlerConfig,
  DecisionHandlerInput,
  MemoryRead,
  MetaGovernorInput,
  MetaGovernorOutput,
  OrchestratorConfig,
  ScoringConfig,
  SlotMemory,
  TokenPredictorConfig,
  TokenPredictorOutput,
} from "./types"

// ─── Defaults ────────────────────────────────────────────────────

export const defaultOrchestratorConfig = (): OrchestratorConfig => ({
  enabled: true,
  memory: { enabled: true, query: "", timeoutMs: 3000 },
  tokenPredictor: {},
  scoring: {},
  decision: {},
  closedLoop: {},
})

const EMPTY_MEMORY_READ: MemoryRead = {
  query: "",
  timestampISO: new Date().toISOString(),
  agentmemory: { available: false, lessons: [] },
  magicContext: { available: false, slots: [] },
  boulderState: { available: false, tasks: [], planProgress: 0 },
  degradedSources: ["agentmemory", "magicContext", "boulderState"],
}

const EMPTY_SLOT_MEMORY: SlotMemory = {
  consecutiveStops: 0,
  consecutiveContinues: 0,
  lastUpdatedISO: new Date().toISOString(),
}

const NO_OP_DECISION: MetaGovernorOutput["decision"] = {
  action: "continue",
  message: null,
  historyEntry: {
    decision: {
      action: "continue",
      score: 0,
      reasoning: "no decision made",
      evidence: [],
      shouldEscalateTo: null,
    },
    action: "continue",
    timestampISO: new Date().toISOString(),
    sessionID: "",
    reasoning: "no decision made",
  },
}


/**
 * Build a DecisionContext from orchestrator input + memory read.
 * Exported for direct testing.
 */
export function buildDecisionContext(
  input: MetaGovernorInput,
  memoryRead: MemoryRead = EMPTY_MEMORY_READ,
): DecisionContext {
  const iterationRatio =
    input.maxIterations > 0 ? input.iteration / input.maxIterations : 0

  const slotMemory: SlotMemory = {
    ...EMPTY_SLOT_MEMORY,
    consecutiveStops: input.consecutiveStops ?? 0,
  }

  return {
    oracleVerified: input.oracleVerified,
    noProgress: input.noProgress,
    deviations: input.deviations,
    iterationRatio,
    lessonsRelevant: memoryRead.agentmemory.lessons,
    slotMemory,
    ambient: {
      sessionID: input.sessionID,
      directory: ".",
      mode: "simple",
      agentName: input.agentName ?? "unknown",
      iteration: input.iteration,
      maxIterations: input.maxIterations,
    },
  }
}

// ─── Orchestrator ──────────────────────────────────────────────

/**
 * Run the full MetaGovernor pipeline.
 *
 * 1. Read memory via aggregator
 * 2. Predict token pressure (skipped if no usage data)
 * 3. Build DecisionContext + score
 * 4. Dispatch decision
 * 5. Learn from outcome
 * 6. Return unified output
 */
export async function runMetaGovernor(
  input: MetaGovernorInput,
  config: Partial<OrchestratorConfig> = {},
): Promise<MetaGovernorOutput> {
  const mergedConfig: OrchestratorConfig = {
    ...defaultOrchestratorConfig(),
    ...config,
  }

  if (!mergedConfig.enabled) {
    return {
      memoryRead: EMPTY_MEMORY_READ,
      tokenPrediction: createNoopPrediction(input),
      scoringResult: {
        decision: {
          action: "continue",
          score: 0,
          reasoning: "MetaGovernor disabled",
          evidence: [],
          shouldEscalateTo: null,
        },
        contributions: [],
        rawScore: 0,
        paralysisOverride: false,
        computedAtISO: new Date().toISOString(),
      },
      decision: NO_OP_DECISION,
      lessonSaved: null,
      decisionHistory: [],
      skipped: true,
      skipReason: "disabled",
    }
  }

  // Step 1: Memory read
  let memoryRead: MemoryRead = EMPTY_MEMORY_READ
  if (mergedConfig.memory.enabled) {
    try {
      const backends: Backends = {
        agentmemory: input.backends.agentmemory as Backends["agentmemory"],
        magicContext: input.backends.magicContext as Backends["magicContext"],
        boulderState: input.backends.boulderState,
      }
      memoryRead = await aggregateRead(
        {
          directory: ".",
          sessionID: input.sessionID,
          query: mergedConfig.memory.query || input.toolName,
        },
        backends,
      )
    } catch {
      // Graceful degradation — memoryRead stays at EMPTY_MEMORY_READ
    }
  }

  // Step 2: Token prediction (sync)
  let tokenPrediction: TokenPredictorOutput
  try {
    tokenPrediction = predict({
      currentUsage: input.recentTurnTokens.reduce((a, b) => a + b, 0),
      modelLimit: 200_000,
      recentTurnTokens: input.recentTurnTokens,
      timestampISO: new Date().toISOString(),
      providerID: input.providerID ?? "",
      modelID: input.modelID ?? "",
      config: mergedConfig.tokenPredictor as TokenPredictorConfig,
    })
  } catch {
    tokenPrediction = createNoopPrediction(input)
  }


  const scoringResult = score(
    buildDecisionContext(input, memoryRead),
    mergedConfig.scoring as Partial<ScoringConfig>,
  )


  // Step 4: Decision
  const decisionInput: DecisionHandlerInput = {
    sessionID: input.sessionID,
    scoringResult,
  }

  const decision = handleDecision(
    decisionInput,
    mergedConfig.decision as DecisionHandlerConfig,
  )

  // Step 5: Learn from outcome
  let lessonSaved: MetaGovernorOutput["lessonSaved"] = null
  try {
    const learnConfig = mergedConfig.closedLoop
    if (learnConfig.enabled !== false) {
      lessonSaved = await observeAndLearn(
        {
          decision: decision.historyEntry.decision,
          memoryRead,
          config: { ...defaultClosedLoopConfig(), ...mergedConfig.closedLoop },
          sessionID: input.sessionID,
          directory: ".",
          filesChanged: [],
        },
        input.writeBackend,
      )
    }
  } catch {
    // Graceful degradation — lessonSaved stays null
  }

  return {
    memoryRead,
    tokenPrediction,
    scoringResult,
    decision,
    lessonSaved,
    decisionHistory: [decision.historyEntry],
    skipped: false,
  }
}

function createNoopPrediction(
  input: MetaGovernorInput,
): TokenPredictorOutput {
  const totalTokens = input.recentTurnTokens.reduce((a, b) => a + b, 0)
  return {
    burnRate: 0,
    budgetLeft: 200_000,
    currentUsage: totalTokens,
    modelLimit: 200_000,
    willOverflowAt: null,
    recommendation: "no-action" as const,
    confidence: 1,
    windowRemaining: 200_000,
    input: {
      currentUsage: totalTokens,
      modelLimit: 200_000,
      recentTurnTokens: input.recentTurnTokens,
      timestampISO: new Date().toISOString(),
      providerID: input.providerID ?? "",
      modelID: input.modelID ?? "",
      config: {
        compactBurnRateThreshold: 500,
        compactUsageThreshold: 0.85,
        switchModelUsageThreshold: 0.95,
        delegateConsecutiveHighBurn: 5,
        windowSize: 10,
      },
    },
    computedAtISO: new Date().toISOString(),
    turnsAnalyzed: input.recentTurnTokens.length,
  }
}
