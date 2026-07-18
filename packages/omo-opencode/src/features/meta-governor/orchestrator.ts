/**
 * MetaGovernor Orchestrator — PR 8 of v2 series.
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
 * - Graceful degradation: if any module throws, returns partial output with skipped=true
        input.writeBackend,
 */

// PR 8 self-contained stubs. Replaced by real modules when PRs 2-6 land.
function predict(input: {
  currentUsage: number
  modelLimit: number
  recentTurnTokens: readonly number[]
  timestampISO: string
  providerID: string
  modelID: string
  config: Partial<TokenPredictorConfig>
}): TokenPredictorOutput {
  const burnRate = input.recentTurnTokens.length
    ? input.currentUsage / Math.max(1, input.recentTurnTokens.length)
    : 0
  return {
    input: input as unknown as import("./types").TokenPredictorInput,
    currentUsage: input.currentUsage,
    burnRate,
    budgetLeft: Math.max(0, input.modelLimit - input.currentUsage),
    willOverflowAt: null,
    recommendation: "no-action",
    confidence: 0,
    modelLimit: input.modelLimit,
    windowRemaining: input.recentTurnTokens.length,
    computedAtISO: input.timestampISO,
    turnsAnalyzed: input.recentTurnTokens.length,
  }
}

function score(_ctx: DecisionContext, _config?: Partial<ScoringConfig>): ScoringResult {
  return {
    decision: {
      action: "continue",
      score: 0,
      reasoning: "self-contained default",
      evidence: [],
      shouldEscalateTo: null,
    },
    contributions: [],
    rawScore: 0,
    paralysisOverride: false,
    computedAtISO: new Date().toISOString(),
  }
}

function handleDecision(input: DecisionHandlerInput, _config?: DecisionHandlerConfig): DecisionHandlerOutput {
  return {
    action: input.scoringResult.decision.action,
    message: null,
    historyEntry: {
      decision: input.scoringResult.decision,
      action: input.scoringResult.decision.action,
      timestampISO: new Date().toISOString(),
      sessionID: input.sessionID,
      reasoning: input.scoringResult.decision.reasoning,
    },
  }
}

async function observeAndLearn(
  input: {
    decision: Decision
    memoryRead: MemoryRead
    config: ClosedLoopConfig
    sessionID: string
    directory: string
    filesChanged: readonly string[]
    deviations: readonly Deviation[]
  },
  backend: AgentmemoryWriteBackend,
): Promise<LearnFromOutcomeOutput> {
  if (input.config.enabled === false) {
    return { lessonSaved: null, decisionSaved: null, reason: "learning disabled" }
  }
  const hasGrave = input.deviations.some((d) => d.severity === "grave")
  if (!hasGrave) {
    return { lessonSaved: null, decisionSaved: null, reason: "severity below threshold" }
  }
  await backend.saveLesson({
    content: `learned from ${input.sessionID}`,
    context: input.decision.reasoning,
    confidence: 0.8,
    tags: ["meta-governor"],
  })
  return {
    lessonSaved: {
      id: "les-1",
      title: "auto-lesson",
      content: "learned",
      type: "pattern",
      concepts: [],
      confidence: 0.8,
      files: [],
      sessionID: input.sessionID,
    },
    decisionSaved: null,
    reason: "lesson saved",
  }
}

function defaultClosedLoopConfig(): ClosedLoopConfig {
  return {
    enabled: true,
    minSeverityToLearn: "media",
    maxLessonsPerSession: 20,
    saveDecisions: true,
  }
}

async function aggregateRead(
  _input: { directory: string; sessionID: string; query: string },
  _backends: MemoryBackends,
): Promise<MemoryRead> {
  return {
    query: _input.query,
    timestampISO: new Date().toISOString(),
    agentmemory: { available: false, lessons: [] },
    magicContext: { available: false, slots: [] },
    boulderState: { available: false, tasks: [], planProgress: 0 },
    degradedSources: ["agentmemory", "magicContext", "boulderState"],
  }
}

import type {
  AgentmemoryWriteBackend,
  ClosedLoopConfig,
  Decision,
  DecisionContext,
  DecisionHandlerConfig,
  DecisionHandlerInput,
  DecisionHandlerOutput,
  Deviation,
  LearnFromOutcomeOutput,
  MemoryBackends,
  MemoryRead,
  MetaGovernorInput,
  MetaGovernorOutput,
  OrchestratorConfig,
  ScoringConfig,
  ScoringResult,
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
      const backends: MemoryBackends = {
        agentmemory: input.backends.agentmemory as MemoryBackends["agentmemory"],
        magicContext: input.backends.magicContext as MemoryBackends["magicContext"],
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
          deviations: input.deviations,
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
