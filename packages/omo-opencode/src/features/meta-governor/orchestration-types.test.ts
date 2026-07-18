/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type {
  DecisionHandlerConfig,
  DecisionHandlerInput,
  DecisionHandlerOutput,
  DecisionHistoryEntry,
  EvidenceContribution,
  MetaGovernorInput,
  MetaGovernorOutput,
  OrchestratorConfig,
  ScoringConfig,
  ScoringResult,
} from "./types"

describe("meta-governor scoring and orchestration types", () => {
  test("connect scoring thresholds to a decision and contribution breakdown", () => {
    // given
    const config: ScoringConfig = {
      continueThreshold: 0.3,
      warnThreshold: 0.3,
      escalateThreshold: 0.6,
      stopThreshold: 0.8,
      paralysisThreshold: 3,
      defaultEscalationTarget: "oracle",
    }
    const contribution: EvidenceContribution = {
      source: "deviation-detector",
      rawScore: -0.6,
      weight: 0.5,
      weightedScore: -0.3,
      description: "grave deviation",
    }
    const result: ScoringResult = {
      decision: { action: "warn", score: -0.4, reasoning: "deviation", evidence: [], shouldEscalateTo: null },
      contributions: [contribution],
      rawScore: -0.4,
      paralysisOverride: false,
      computedAtISO: "2026-06-09T12:00:00.000Z",
    }

    // when
    const shouldWarn = result.rawScore < -config.warnThreshold

    // then
    expect(shouldWarn).toBe(true)
    expect(result.contributions[0]?.source).toBe("deviation-detector")
  })

  test("carry decision-handler input, output, and history", () => {
    // given
    const config: DecisionHandlerConfig = {
      enabled: true,
      maxHistoryPerSession: 50,
      forceContinueAfterStops: 3,
      warnMessageTemplate: "warn {score}",
      escalateMessageTemplate: "escalate {target}",
      stopMessageTemplate: "stop {reasoning}",
      defaultEscalationTarget: "oracle",
    }
    const scoringResult: ScoringResult = {
      decision: { action: "warn", score: -0.4, reasoning: "deviation", evidence: [], shouldEscalateTo: null },
      contributions: [],
      rawScore: -0.4,
      paralysisOverride: false,
      computedAtISO: "2026-06-09T12:00:00.000Z",
    }
    const input: DecisionHandlerInput = { scoringResult, sessionID: "ses_test" }
    const historyEntry: DecisionHistoryEntry = {
      decision: scoringResult.decision,
      action: "warn",
      timestampISO: "2026-06-09T12:00:01.000Z",
      sessionID: input.sessionID,
      reasoning: "deviation",
    }
    const output: DecisionHandlerOutput = { action: "warn", message: "warn -0.4", historyEntry }

    // when
    const historyAllowed = config.maxHistoryPerSession > 0

    // then
    expect(historyAllowed).toBe(true)
    expect(output.historyEntry.sessionID).toBe(input.sessionID)
  })

  test("define orchestrator config, input ports, and output bundle", () => {
    // given
    const config: OrchestratorConfig = {
      enabled: true,
      memory: { enabled: true, query: "meta", timeoutMs: 1_000 },
      tokenPredictor: { windowSize: 10 },
      scoring: { defaultEscalationTarget: "oracle" },
      decision: { enabled: true },
      closedLoop: { enabled: true },
    }
    const input: MetaGovernorInput = {
      sessionID: "ses_test",
      toolName: "bash",
      iteration: 1,
      maxIterations: 10,
      oracleVerified: true,
      noProgress: false,
      filesChanged: 1,
      recentTurnTokens: [100],
      deviations: [],
      backends: {
        agentmemory: { smartSearch: async () => ({ lessons: [], crystals: [] }) },
        magicContext: { slotList: async () => [] },
        boulderState: { boulderRead: async () => [] },
      },
      writeBackend: {
        saveMemory: async () => ({ id: "mem" }),
        saveLesson: async () => ({ id: "lesson" }),
      },
      config,
    }
    const output: MetaGovernorOutput = {
      memoryRead: {
        query: "meta",
        timestampISO: "2026-06-09T12:00:00.000Z",
        agentmemory: { available: true, lessons: [] },
        magicContext: { available: true, slots: [] },
        boulderState: { available: true, tasks: [], planProgress: 0 },
        degradedSources: [],
      },
      tokenPrediction: {
        currentUsage: 100,
        burnRate: 1,
        budgetLeft: 199_900,
        willOverflowAt: null,
        recommendation: "no-action",
        confidence: 0.8,
        modelLimit: 200_000,
        windowRemaining: 199_900,
        input: {
          currentUsage: 100,
          modelLimit: 200_000,
          recentTurnTokens: [100],
          timestampISO: "2026-06-09T12:00:00.000Z",
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          config: {
            compactBurnRateThreshold: 500,
            compactUsageThreshold: 0.85,
            switchModelUsageThreshold: 0.95,
            delegateConsecutiveHighBurn: 5,
            windowSize: 10,
          },
        },
        computedAtISO: "2026-06-09T12:00:00.000Z",
        turnsAnalyzed: 1,
      },
      scoringResult: {
        decision: { action: "continue", score: 0.5, reasoning: "ok", evidence: [], shouldEscalateTo: null },
        contributions: [],
        rawScore: 0.5,
        paralysisOverride: false,
        computedAtISO: "2026-06-09T12:00:00.000Z",
      },
      decision: {
        action: "continue",
        message: null,
        historyEntry: {
          decision: { action: "continue", score: 0.5, reasoning: "ok", evidence: [], shouldEscalateTo: null },
          action: "continue",
          timestampISO: "2026-06-09T12:00:00.000Z",
          sessionID: "ses_test",
          reasoning: "ok",
        },
      },
      lessonSaved: null,
      decisionHistory: [],
      skipped: false,
    }

    // when
    const hasPorts = input.backends.agentmemory !== undefined && input.writeBackend !== undefined

    // then
    expect(hasPorts).toBe(true)
    expect(output.skipped).toBe(false)
    expect(output.decision.action).toBe("continue")
  })
})
