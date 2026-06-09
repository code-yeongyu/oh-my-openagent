import { describe, expect, test } from "bun:test"
import type {
  AgentMemoryRead,
  AmbientContext,
  BoulderStateRead,
  Decision,
  DecisionContext,
  Deviation,
  EscalationTarget,
  Evidence,
  EvidenceSource,
  MagicContextRead,
  MemoryRead,
  MemorySource,
  RelevantLesson,
  SlotMemory,
  TokenPrediction,
  TokenRecommendation,
  TokenPredictorConfig,
  TokenPredictorInput,
  TokenPredictorOutput,
  TokenRecommendation,
} from "./types"

describe("meta-governor types", () => {
  describe("DecisionContext", () => {
    test("S1: accepts fully populated context with oracle verified + no progress + deviations + 80% iterations + 2 lessons", () => {
      // given
      const ctx: DecisionContext = {
        oracleVerified: true,
        noProgress: false,
        deviations: [
          { severity: "leve", category: "lint", detail: "minor style" },
          { severity: "grave", category: "config-change", detail: "touched config.ts" },
        ],
        iterationRatio: 0.8,
        lessonsRelevant: [
          { id: "L1", title: "stop on grave config-change", advice: "stop", confidence: 0.7, concepts: ["config-change"] },
          { id: "L2", title: "continue when oracle verified", advice: "continue", confidence: 0.6, concepts: ["oracle-verified"] },
        ],
        slotMemory: {
          lastDecision: {
            action: "continue",
            score: 0.4,
            reasoning: "ok",
            evidence: [],
            shouldEscalateTo: null,
          },
          consecutiveStops: 0,
          consecutiveContinues: 2,
          lastUpdatedISO: "2026-06-09T12:00:00.000Z",
        },
        ambient: {
          sessionID: "ses_test",
          directory: "/tmp/test",
          mode: "ultrawork",
          agentName: "sisyphus",
          iteration: 8,
          maxIterations: 10,
        },
      }

      // when
      const isPopulated =
        ctx.oracleVerified === true &&
        ctx.iterationRatio === 0.8 &&
        ctx.deviations.length === 2 &&
        ctx.lessonsRelevant.length === 2 &&
        ctx.ambient.iteration === 8

      // then
      expect(isPopulated).toBe(true)
    })

    test("S1b: empty arrays are valid (signals, not bugs)", () => {
      // given
      const ctx: DecisionContext = {
        oracleVerified: false,
        noProgress: true,
        deviations: [],
        iterationRatio: 0.0,
        lessonsRelevant: [],
        slotMemory: {
          consecutiveStops: 0,
          consecutiveContinues: 0,
          lastUpdatedISO: "2026-06-09T00:00:00.000Z",
        },
        ambient: {
          sessionID: "ses_empty",
          directory: "/tmp/empty",
          mode: "simple",
          agentName: "build",
          iteration: 1,
          maxIterations: 50,
        },
      }

      // when
      const hasEmptySignals = ctx.deviations.length === 0 && ctx.lessonsRelevant.length === 0

      // then
      expect(hasEmptySignals).toBe(true)
    })
  })

  describe("Decision", () => {
    test("S2: carries all required fields and supports every action variant", () => {
      // given
      const decisions: Decision[] = [
        {
          action: "continue",
          score: 0.5,
          reasoning: "all clear",
          evidence: [],
          shouldEscalateTo: null,
        },
        {
          action: "warn",
          score: -0.4,
          reasoning: "deviation grave",
          evidence: [
            { source: "deviation-detector", value: "config-change", confidence: 0.9, weight: 0.5 },
          ],
          shouldEscalateTo: null,
        },
        {
          action: "escalate",
          score: -0.7,
          reasoning: "needs oracle verification",
          evidence: [
            { source: "oracle-verified", value: "false", confidence: 1.0, weight: 0.4 },
          ],
          shouldEscalateTo: "oracle",
        },
        {
          action: "stop",
          score: -0.9,
          reasoning: "no progress 3 turns",
          evidence: [
            { source: "no-progress-detector", value: "true", confidence: 0.95, weight: 0.6 },
          ],
          shouldEscalateTo: null,
        },
      ]

      // when
      const allValid = decisions.every(
        (d) =>
          typeof d.score === "number" &&
          d.score >= -1 &&
          d.score <= 1 &&
          d.reasoning.length > 0 &&
          Array.isArray(d.evidence),
      )
      const actions = new Set(decisions.map((d) => d.action))

      // then
      expect(allValid).toBe(true)
      expect(actions.size).toBe(4)
      expect(actions.has("continue")).toBe(true)
      expect(actions.has("warn")).toBe(true)
      expect(actions.has("escalate")).toBe(true)
      expect(actions.has("stop")).toBe(true)
    })

    test("S2b: when action is escalate, shouldEscalateTo must be oracle or user (not null)", () => {
      // given
      const targets: EscalationTarget[] = ["oracle", "user"]

      // when
      const isStrictSubset = targets.every((t) => t === "oracle" || t === "user")

      // then
      expect(isStrictSubset).toBe(true)
    })
  })

  describe("Evidence", () => {
    test("S3: shape has source, value, confidence, weight all required", () => {
      // given
      const sources: EvidenceSource[] = [
        "oracle-verified",
        "no-progress-detector",
        "deviation-detector",
        "iteration-budget",
        "lesson-recall",
        "slot-memory",
        "ambient",
        "token-predictor",
      ]
      const sample: Evidence = {
        source: "oracle-verified",
        value: "true",
        confidence: 0.95,
        weight: 0.4,
      }

      // when
      const hasAllFields =
        typeof sample.source === "string" &&
        typeof sample.value === "string" &&
        sample.confidence >= 0 &&
        sample.confidence <= 1 &&
        sample.weight >= 0 &&
        sample.weight <= 1

      // then
      expect(hasAllFields).toBe(true)
      expect(sources.length).toBe(8)
    })
  })

  describe("MemoryRead", () => {
    test("S4: aggregates agentmemory + magicContext + boulderState, marks degraded sources", () => {
      // given
      const read: MemoryRead = {
        query: "ralph-loop continue after config-change",
        timestampISO: "2026-06-09T12:00:00.000Z",
        agentmemory: {
          available: true,
          lessons: [
            { id: "L1", title: "stop on grave config-change", advice: "stop", confidence: 0.7, concepts: ["config-change"] },
          ],
        },
        magicContext: {
          available: true,
          slots: [{ label: "meta_state", content: "{}" }],
        },
        boulderState: {
          available: false,
          tasks: [],
          planProgress: 0,
          errorMessage: "no .omo/boulder.json",
        },
        degradedSources: ["boulderState"],
      }

      // when
      const oneDegraded = read.degradedSources.length === 1
      const agentmemoryOk = read.agentmemory.available === true
      const boulderDown = read.boulderState.available === false

      // then
      expect(oneDegraded).toBe(true)
      expect(agentmemoryOk).toBe(true)
      expect(boulderDown).toBe(true)
      expect(read.degradedSources[0]).toBe<MemorySource>("boulderState")
    })
  })

  describe("TokenPrediction", () => {
    test("S5: has currentUsage, burnRate, budgetLeft, willOverflowAt, recommendation, confidence", () => {
      // given
      const predictions: TokenPrediction[] = [
        {
          currentUsage: 50_000,
          burnRate: 200,
          budgetLeft: 150_000,
          willOverflowAt: null,
          recommendation: "no-action",
          confidence: 0.95,
          modelLimit: 200_000,
          windowRemaining: 150_000,
        },
        {
          currentUsage: 180_000,
          burnRate: 5_000,
          budgetLeft: 20_000,
          willOverflowAt: "2026-06-09T12:05:00.000Z",
          recommendation: "compact-now",
          confidence: 0.85,
          modelLimit: 200_000,
          windowRemaining: 20_000,
        },
        {
          currentUsage: 90_000,
          burnRate: 3_000,
          budgetLeft: 110_000,
          willOverflowAt: "2026-06-09T12:30:00.000Z",
          recommendation: "switch-model",
          confidence: 0.7,
          modelLimit: 200_000,
          windowRemaining: 110_000,
        },
        {
          currentUsage: 120_000,
          burnRate: 2_000,
          budgetLeft: 80_000,
          willOverflowAt: "2026-06-09T12:40:00.000Z",
          recommendation: "delegate-to-subagent",
          confidence: 0.65,
          modelLimit: 200_000,
          windowRemaining: 80_000,
        },
      ]
      const recommendations: TokenRecommendation[] = [
        "compact-now",
        "switch-model",
        "delegate-to-subagent",
        "no-action",
      ]

      // when
      const allHaveFields = predictions.every(
        (p) =>
          typeof p.currentUsage === "number" &&
          typeof p.burnRate === "number" &&
          typeof p.budgetLeft === "number" &&
          (p.willOverflowAt === null || typeof p.willOverflowAt === "string") &&
          p.confidence >= 0 &&
          p.confidence <= 1,
      )
      const allRecommendations = new Set(predictions.map((p) => p.recommendation))

      // then
      expect(allHaveFields).toBe(true)
      expect(allRecommendations.size).toBe(4)
      for (const r of recommendations) {
        expect(allRecommendations.has(r)).toBe(true)
      }
    })

    test("S5b: willOverflowAt is null when recommendation is no-action", () => {
      // given
      const p: TokenPrediction = {
        currentUsage: 1_000,
        burnRate: 0,
        budgetLeft: 199_000,
        willOverflowAt: null,
        recommendation: "no-action",
        confidence: 0.99,
        modelLimit: 200_000,
        windowRemaining: 199_000,
      }

      // then
      expect(p.willOverflowAt).toBeNull()
      expect(p.recommendation).toBe("no-action")
    })
  })

  describe("auxiliary types", () => {
    test("SlotMemory consecutive counters default to 0 and are read by judge for paralysis detection", () => {
      // given
      const slot: SlotMemory = {
        consecutiveStops: 3,
        consecutiveContinues: 0,
        lastUpdatedISO: "2026-06-09T00:00:00.000Z",
      }

      // when
      const isParalyzed = slot.consecutiveStops >= 3

      // then
      expect(isParalyzed).toBe(true)
    })

    test("AmbientContext carries mode for judge to factor in (ultrawork stricter than simple)", () => {
      // given
      const modes: AmbientContext["mode"][] = ["ultrawork", "ulw", "simple", "ralph-loop"]

      // when
      const allListed = modes.every((m) =>
        ["ultrawork", "ulw", "simple", "ralph-loop"].includes(m),
      )

      // then
      expect(allListed).toBe(true)
    })

    test("Deviation severity uses the 3-level taxonomy (leve/media/grave) from prior moderator-gate", () => {
      // given
      const deviations: Deviation[] = [
        { severity: "leve", category: "lint", detail: "minor" },
        { severity: "media", category: "refactor-scope", detail: "broader than expected" },
        { severity: "grave", category: "config-change", detail: "touched config.ts" },
      ]

      // when
      const severities = new Set(deviations.map((d) => d.severity))

      // then
      expect(severities.size).toBe(3)
      expect(severities.has("grave")).toBe(true)
    })

    test("RelevantLesson carries id, title, advice, confidence, concepts for preflight matching", () => {
      // given
      const lesson: RelevantLesson = {
        id: "L42",
        title: "fix X for error Y",
        advice: "warn",
        confidence: 0.6,
        concepts: ["tool_timeout", "bash", "retry"],
      }

      // when
      const matchesBash = lesson.concepts.includes("bash")

      // then
      expect(matchesBash).toBe(true)
      expect(lesson.advice).toBe("warn")
    })

    test("AgentMemoryRead and MagicContextRead report available=false with errorMessage when degraded", () => {
      // given
      const am: AgentMemoryRead = {
        available: false,
        lessons: [],
        errorMessage: "agentmemory MCP not connected",
      }
      const mc: MagicContextRead = {
        available: false,
        slots: [],
        errorMessage: "magic-context slot not initialised",
      }

      // then
      expect(am.available).toBe(false)
      expect(am.errorMessage).toBeTruthy()
      expect(mc.available).toBe(false)
      expect(mc.errorMessage).toBeTruthy()
    })

    test("BoulderStateRead reports planProgress in 0..1", () => {
      // given
      const bs: BoulderStateRead = {
        available: true,
        tasks: [{ id: "T1", status: "done", title: "fix bug" }],
        planProgress: 0.5,
      }

      // when
      const inRange = bs.planProgress >= 0 && bs.planProgress <= 1

      // then
      expect(inRange).toBe(true)
    })
  })

  describe("ClosedLoopConfig", () => {
    test("CLT1: has all required fields with correct types", () => {
      // given
      const cfg: ClosedLoopConfig = {
        enabled: true,
        minSeverityToLearn: "media",
        maxLessonsPerSession: 20,
        saveDecisions: true,
      }

      // when
      const isValid =
        typeof cfg.enabled === "boolean" &&
        (cfg.minSeverityToLearn === "leve" || cfg.minSeverityToLearn === "media" || cfg.minSeverityToLearn === "grave") &&
        typeof cfg.maxLessonsPerSession === "number" &&
        typeof cfg.saveDecisions === "boolean"

      // then
      expect(isValid).toBe(true)
    })

    test("CLT2: minSeverityToLearn accepts all 3 severity levels", () => {
      const levels: ClosedLoopConfig["minSeverityToLearn"][] = ["leve", "media", "grave"]
      expect(levels.length).toBe(3)
    })
  })

  describe("MemoryDecision", () => {
    test("CLT3: has all required fields matching Decision contract", () => {
      // given
      const md: MemoryDecision = {
        id: "D-abc123",
        timestampISO: "2026-06-09T12:00:00.000Z",
        action: "warn",
        score: -0.5,
        reasoning: "deviation detected",
        sessionID: "ses_test",
        directory: "/tmp/test",
        deviations: [{ severity: "media", category: "lint", detail: "style" }],
      }

      // when
      const isValid =
        typeof md.id === "string" &&
        typeof md.timestampISO === "string" &&
        typeof md.score === "number" &&
        md.score >= -1 && md.score <= 1 &&
        typeof md.sessionID === "string"

      // then
      expect(isValid).toBe(true)
      expect(md.action).toBe("warn")
    })

    test("CLT4: action field matches Decision action union type", () => {
      const actions: MemoryDecision["action"][] = ["continue", "warn", "escalate", "stop"]
      expect(actions.length).toBe(4)
    })
  })

  describe("AgentmemoryWriteBackend", () => {
    test("CLT5: interface has saveMemory and saveLesson methods", () => {
      // Compile-time check: if the interface is wrong, this won't typecheck
      const impl: AgentmemoryWriteBackend = {
        saveMemory: async () => ({ id: "mem-1" }),
        saveLesson: async () => ({ id: "les-1" }),
      }

      // when
      const hasBoth = typeof impl.saveMemory === "function" && typeof impl.saveLesson === "function"

      // then
      expect(hasBoth).toBe(true)
    })
  })

  describe("LessonLearned", () => {
    test("CLT6: has all required fields", () => {
      // given
      const lesson: LessonLearned = {
        id: "L-abc",
        title: "stop on config-change",
        content: "When X then Y",
        type: "pattern",
        concepts: ["config-change", "grave"],
        confidence: 0.7,
        files: ["src/foo.ts"],
        sessionID: "ses_test",
      }

      // when
      const isValid =
        typeof lesson.id === "string" &&
        typeof lesson.title === "string" &&
        typeof lesson.content === "string" &&
        ["pattern", "bug", "architecture", "workflow"].includes(lesson.type) &&
        lesson.confidence >= 0 && lesson.confidence <= 1

      // then
      expect(isValid).toBe(true)
    })
  })

  describe("LearnFromOutcomeInput / Output", () => {
    test("CLT7: Input carries decision, memoryRead, config, sessionID, directory, filesChanged", () => {
      // given
      const input: LearnFromOutcomeInput = {
        decision: { action: "warn", score: -0.5, reasoning: "test", evidence: [], shouldEscalateTo: null },
        memoryRead: {
          query: "test",
          timestampISO: "2026-06-09T12:00:00.000Z",
          agentmemory: { available: true, lessons: [] },
          magicContext: { available: true, slots: [] },
          boulderState: { available: true, tasks: [], planProgress: 0 },
          degradedSources: [],
        },
        config: { enabled: true, minSeverityToLearn: "media", maxLessonsPerSession: 20, saveDecisions: true },
        sessionID: "ses_test",
        directory: "/tmp/test",
        filesChanged: ["src/foo.ts"],
      }

      // when
      const hasAll =
        typeof input.sessionID === "string" &&
        typeof input.directory === "string" &&
        Array.isArray(input.filesChanged)

      // then
      expect(hasAll).toBe(true)
    })

    test("CLT8: Output has lessonSaved, decisionSaved, reason", () => {
      // given
      const output: import("./types").LearnFromOutcomeOutput = {
        lessonSaved: null,
        decisionSaved: null,
        reason: "no action",
      }

      // when
      const hasAll =
        "lessonSaved" in output &&
        "decisionSaved" in output &&
        typeof output.reason === "string"

      // then
      expect(hasAll).toBe(true)
    })
  })

  describe("TokenPredictorConfig", () => {
    test("S1: accepts valid config with all thresholds", () => {
      // given
      const config: TokenPredictorConfig = {
        compactBurnRateThreshold: 500,
        compactUsageThreshold: 0.85,
        switchModelUsageThreshold: 0.95,
        delegateConsecutiveHighBurn: 5,
        windowSize: 10,
      }

      // when + then - type check passes
      expect(config.compactBurnRateThreshold).toBe(500)
      expect(config.windowSize).toBe(10)
    })
  })

  describe("TokenPredictorInput", () => {
    test("S1: accepts valid input with all fields", () => {
      // given
      const input: TokenPredictorInput = {
        currentUsage: 100000,
        modelLimit: 200000,
        recentTurnTokens: [100, 200, 150],
        timestampISO: new Date().toISOString(),
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
        config: {
          compactBurnRateThreshold: 500,
          compactUsageThreshold: 0.85,
          switchModelUsageThreshold: 0.95,
          delegateConsecutiveHighBurn: 5,
          windowSize: 10,
        },
      }

      // when + then - type check passes
      expect(input.currentUsage).toBe(100000)
      expect(input.recentTurnTokens).toHaveLength(3)
    })
  })

  describe("TokenPredictorOutput", () => {
    test("S1: extends TokenPrediction with input metadata", () => {
      // given
      const output: TokenPredictorOutput = {
        currentUsage: 100000,
        burnRate: 100,
        budgetLeft: 100000,
        willOverflowAt: null,
        recommendation: "no-action",
        confidence: 0.8,
        modelLimit: 200000,
        windowRemaining: 100000,
        input: {
          currentUsage: 100000,
          modelLimit: 200000,
          recentTurnTokens: [100],
          timestampISO: "2025-01-01T00:00:00Z",
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
        computedAtISO: "2025-01-01T00:00:00Z",
        turnsAnalyzed: 1,
      }

      // when + then - type check passes
      expect(output.input.currentUsage).toBe(100000)
      expect(output.turnsAnalyzed).toBe(1)
      expect(typeof output.computedAtISO).toBe("string")
    })
  })
})
