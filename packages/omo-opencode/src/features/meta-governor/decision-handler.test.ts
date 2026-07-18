import { describe, expect, it } from "bun:test"
import {
  handleDecision,
  defaultDecisionHandlerConfig,
  trimHistory,
  countConsecutiveStops,
} from "./decision-handler"
import type {
  ScoringResult,
  DecisionHandlerInput,
  Decision,
  DecisionHandlerConfig,
  SlotMemory,
  AmbientContext,
} from "./types"

// ─── Test helpers ──────────────────────────────────────────────────

function makeAmbient(overrides?: Partial<AmbientContext>): AmbientContext {
  return {
    sessionID: "test-session-001",
    directory: "/tmp/test",
    mode: "ultrawork",
    agentName: "sisyphus",
    iteration: 5,
    maxIterations: 20,
    ...overrides,
  }
}

function makeSlotMemory(overrides?: Partial<SlotMemory>): SlotMemory {
  return {
    consecutiveStops: 0,
    consecutiveContinues: 0,
    lastUpdatedISO: "2026-06-09T10:00:00Z",
    ...overrides,
  }
}

function makeDecision(overrides?: Partial<Decision>): Decision {
  return {
    action: "continue",
    score: 0.5,
    reasoning: "Test reasoning",
    evidence: [],
    shouldEscalateTo: null,
    ...overrides,
  }
}

function makeScoringResult(overrides?: Partial<ScoringResult>): ScoringResult {
  return {
    decision: makeDecision(),
    contributions: [],
    rawScore: 0.5,
    paralysisOverride: false,
    computedAtISO: "2026-06-09T10:00:00Z",
    ...overrides,
  }
}

function makeInput(
  overrides?: Partial<DecisionHandlerInput>,
): DecisionHandlerInput {
  return {
    scoringResult: makeScoringResult(),
    sessionID: "test-session-001",
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("#given defaultConfig", () => {
  it("returns correct defaults", () => {
    const config = defaultDecisionHandlerConfig()

    expect(config.enabled).toBe(true)
    expect(config.maxHistoryPerSession).toBe(50)
    expect(config.forceContinueAfterStops).toBe(3)
    expect(config.warnMessageTemplate).toContain("{score}")
    expect(config.escalateMessageTemplate).toContain("{target}")
    expect(config.stopMessageTemplate).toContain("{reasoning}")
  })
})

describe("#given disabled handler", () => {
  it("returns continue with no message", () => {
    const result = handleDecision(makeInput(), { enabled: false })

    expect(result.action).toBe("continue")
    expect(result.message).toBeNull()
    expect(result.historyEntry.decision.action).toBe("continue")
  })

  it("sets reasoning to disabled pass-through", () => {
    const result = handleDecision(makeInput(), { enabled: false })

    expect(result.historyEntry.reasoning).toContain("disabled")
  })
})

describe("#given continue action", () => {
  it("returns continue with no message", () => {
    const result = handleDecision(makeInput())

    expect(result.action).toBe("continue")
    expect(result.message).toBeNull()
  })

  it("records history entry with score", () => {
    const result = handleDecision(makeInput())

    expect(result.historyEntry.decision.score).toBe(0.5)
    expect(result.historyEntry.sessionID).toBe("test-session-001")
  })
})

describe("#given warn action", () => {
  it("returns warn with formatted message", () => {
    const result = handleDecision(
      makeInput({
        scoringResult: makeScoringResult({
          decision: makeDecision({
            action: "warn",
            score: -0.4,
            reasoning: "Deviation detected",
            evidence: [{ source: "deviation-detector", value: "test", confidence: 0.8, weight: 0.2 }],
          }),
        }),
      }),
    )

    expect(result.action).toBe("warn")
    expect(result.message).toContain("-0.400")
    expect(result.message).toContain("Deviation detected")
  })

  it("includes evidence count in message", () => {
    const result = handleDecision(
      makeInput({
        scoringResult: makeScoringResult({
          decision: makeDecision({
            action: "warn",
            score: -0.35,
            reasoning: "Low confidence",
            evidence: [
              { source: "deviation-detector", value: "a", confidence: 0.5, weight: 0.2 },
              { source: "lesson-recall", value: "b", confidence: 0.7, weight: 0.1 },
            ],
          }),
        }),
      }),
    )

    expect(result.message).toContain("2 signal(s)")
  })
})

describe("#given escalate action", () => {
  it("returns escalate with target in message", () => {
    const result = handleDecision(
      makeInput({
        scoringResult: makeScoringResult({
          decision: makeDecision({
            action: "escalate",
            score: -0.7,
            reasoning: "Serious issue",
            shouldEscalateTo: "oracle",
            evidence: [{ source: "deviation-detector", value: "grave", confidence: 0.9, weight: 0.2 }],
          }),
        }),
      }),
    )

    expect(result.action).toBe("escalate")
    expect(result.message).toContain("oracle")
    expect(result.message).toContain("Serious issue")
  })

  it("uses default target when shouldEscalateTo is null", () => {
    const result = handleDecision(
      makeInput({
        scoringResult: makeScoringResult({
          decision: makeDecision({
            action: "escalate",
            score: -0.7,
            reasoning: "Issue",
            shouldEscalateTo: null,
          }),
        }),
      }),
    )

    expect(result.message).toContain("oracle")
  })
})

describe("#given stop action", () => {
  it("returns stop with message", () => {
    const result = handleDecision(
      makeInput({
        scoringResult: makeScoringResult({
          decision: makeDecision({
            action: "stop",
            score: -0.9,
            reasoning: "Critical failure",
            evidence: [{ source: "no-progress-detector", value: "stuck", confidence: 0.95, weight: 0.2 }],
          }),
        }),
      }),
    )

    expect(result.action).toBe("stop")
    expect(result.message).toContain("STOP")
    expect(result.message).toContain("Critical failure")
    expect(result.message).toContain("1 signal(s)")
  })
})

describe("#given paralysis override", () => {
  it("forces continue despite negative score", () => {
    const result = handleDecision(
      makeInput({
        scoringResult: makeScoringResult({
          decision: makeDecision({
            action: "stop",
            score: -0.9,
            reasoning: "Would stop",
          }),
          paralysisOverride: true,
        }),
      }),
    )

    expect(result.action).toBe("continue")
    expect(result.message).toContain("Paralysis detected")
  })

  it("records paralysis in history reasoning", () => {
    const result = handleDecision(
      makeInput({
        scoringResult: makeScoringResult({
          decision: makeDecision({
            action: "escalate",
            score: -0.7,
            reasoning: "Escalation needed",
          }),
          paralysisOverride: true,
        }),
      }),
    )

    expect(result.historyEntry.reasoning).toContain("Paralysis override")
  })
})

describe("#given trimHistory", () => {
  it("returns same array when under max", () => {
    const entries = [{ action: "continue" }, { action: "warn" }] as any
    const result = trimHistory(entries, 50)

    expect(result.trimmed).toHaveLength(2)
    expect(result.dropped).toBe(0)
  })

  it("trims oldest when over max", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      action: "continue",
      reasoning: `entry-${i}`,
    })) as any
    const result = trimHistory(entries, 50)

    expect(result.trimmed).toHaveLength(50)
    expect(result.dropped).toBe(10)
    expect(result.trimmed[0]!.reasoning).toBe("entry-10")
  })
})

describe("#given countConsecutiveStops", () => {
  it("returns 0 for empty history", () => {
    expect(countConsecutiveStops([])).toBe(0)
  })

  it("counts stops from the end", () => {
    const history = [
      { action: "continue" },
      { action: "warn" },
      { action: "stop" },
      { action: "stop" },
      { action: "stop" },
    ] as any
    expect(countConsecutiveStops(history)).toBe(3)
  })

  it("stops counting at first non-stop", () => {
    const history = [
      { action: "stop" },
      { action: "stop" },
      { action: "warn" },
      { action: "stop" },
    ] as any
    expect(countConsecutiveStops(history)).toBe(1)  // last stop before non-stop counts
  })
})
