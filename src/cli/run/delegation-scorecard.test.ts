import { describe, expect, test } from "bun:test"
import { calculateScorecard, SCORECARD_VERSION } from "./delegation-scorecard"
import type { MetricSnapshot } from "./event-metric-collector"

function snapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    delegationAttempts: 0,
    delegationSuccesses: 0,
    directImplementationAttempts: 0,
    otherToolCalls: 0,
    totalToolCalls: 0,
    eventsAnalyzed: 0,
    firstToolTimestamp: null,
    lastToolTimestamp: null,
    ...overrides,
  }
}

describe("calculateScorecard", () => {
  test("#given deep scenario with delegation #when calculating scorecard #then passes with versioned score", () => {
    const result = calculateScorecard({
      scenarioId: "deep-delegates",
      tier: "deep",
      snapshot: snapshot({ delegationAttempts: 2, delegationSuccesses: 2, totalToolCalls: 3, eventsAnalyzed: 5 }),
      durationMs: 1000,
      success: true,
    })

    expect(result.passed).toBe(true)
    expect(result.delegationRate).toBe(66.67)
    expect(result.avoidanceScore).toBe(100)
    expect(result.scorecardVersion).toBe(SCORECARD_VERSION)
  })

  test("#given deep scenario without delegation #when calculating scorecard #then fails regardless of high avoidance", () => {
    const result = calculateScorecard({
      scenarioId: "deep-no-delegation",
      tier: "deep",
      snapshot: snapshot({ otherToolCalls: 2, totalToolCalls: 2, eventsAnalyzed: 2 }),
      durationMs: 1000,
      success: true,
    })

    expect(result.passed).toBe(false)
    expect(result.delegationRate).toBe(0)
  })

  test("#given quick scenario with unnecessary delegation #when calculating scorecard #then fails quick delegation cap", () => {
    const result = calculateScorecard({
      scenarioId: "quick-overdelegates",
      tier: "quick",
      snapshot: snapshot({ delegationAttempts: 1, delegationSuccesses: 1, totalToolCalls: 2, eventsAnalyzed: 3 }),
      durationMs: 500,
      success: true,
    })

    expect(result.delegationRate).toBe(50)
    expect(result.passed).toBe(false)
  })

  test("#given medium scenario #when calculating scorecard #then uses normalized non-null weights", () => {
    const result = calculateScorecard({
      scenarioId: "medium-balanced",
      tier: "medium",
      snapshot: snapshot({ delegationAttempts: 1, directImplementationAttempts: 1, totalToolCalls: 4, eventsAnalyzed: 5 }),
      durationMs: 1200,
      success: true,
    })

    expect(result.speedScore).toBeNull()
    expect(result.totalScore).toBeGreaterThan(0)
    expect(result.eventsAnalyzed).toBe(5)
  })

  test("#given unsuccessful scenario #when calculating scorecard #then success score is zero", () => {
    const result = calculateScorecard({
      scenarioId: "failed-run",
      tier: "medium",
      snapshot: snapshot({ totalToolCalls: 1, otherToolCalls: 1, eventsAnalyzed: 1 }),
      durationMs: 1000,
      success: false,
    })

    expect(result.successScore).toBe(0)
  })
})
