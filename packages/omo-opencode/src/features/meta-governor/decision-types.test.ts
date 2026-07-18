/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type {
  AmbientContext,
  Decision,
  DecisionContext,
  Deviation,
  EscalationTarget,
  Evidence,
  EvidenceSource,
  RelevantLesson,
  SlotMemory,
} from "./types"

describe("meta-governor decision types", () => {
  test("accept a populated decision context with required signals", () => {
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
        lastDecision: { action: "continue", score: 0.4, reasoning: "ok", evidence: [], shouldEscalateTo: null },
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
    const signalCount = ctx.deviations.length + ctx.lessonsRelevant.length

    // then
    expect(ctx.oracleVerified).toBe(true)
    expect(ctx.iterationRatio).toBe(0.8)
    expect(signalCount).toBe(4)
  })

  test("allow empty signal arrays as explicit inputs", () => {
    // given
    const ctx: DecisionContext = {
      oracleVerified: false,
      noProgress: true,
      deviations: [],
      iterationRatio: 0,
      lessonsRelevant: [],
      slotMemory: { consecutiveStops: 0, consecutiveContinues: 0, lastUpdatedISO: "2026-06-09T00:00:00.000Z" },
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

  test("support every decision action and escalation target", () => {
    // given
    const decisions: readonly Decision[] = [
      { action: "continue", score: 0.5, reasoning: "all clear", evidence: [], shouldEscalateTo: null },
      {
        action: "warn",
        score: -0.4,
        reasoning: "deviation grave",
        evidence: [{ source: "deviation-detector", value: "config-change", confidence: 0.9, weight: 0.5 }],
        shouldEscalateTo: null,
      },
      {
        action: "escalate",
        score: -0.7,
        reasoning: "needs oracle verification",
        evidence: [{ source: "oracle-verified", value: "false", confidence: 1, weight: 0.4 }],
        shouldEscalateTo: "oracle",
      },
      {
        action: "stop",
        score: -0.9,
        reasoning: "no progress 3 turns",
        evidence: [{ source: "no-progress-detector", value: "true", confidence: 0.95, weight: 0.6 }],
        shouldEscalateTo: null,
      },
    ]
    const targets: readonly EscalationTarget[] = ["oracle", "user"]

    // when
    const actions = new Set(decisions.map((decision) => decision.action))

    // then
    expect(actions).toEqual(new Set(["continue", "warn", "escalate", "stop"]))
    expect(targets).toEqual(["oracle", "user"])
  })

  test("carry evidence, severity, lesson, slot, and ambient variants", () => {
    // given
    const sources: readonly EvidenceSource[] = [
      "oracle-verified",
      "no-progress-detector",
      "deviation-detector",
      "iteration-budget",
      "lesson-recall",
      "slot-memory",
      "ambient",
      "token-predictor",
    ]
    const evidence: Evidence = { source: "oracle-verified", value: "true", confidence: 0.95, weight: 0.4 }
    const deviations: readonly Deviation[] = [
      { severity: "leve", category: "lint", detail: "minor" },
      { severity: "media", category: "refactor-scope", detail: "broader than expected" },
      { severity: "grave", category: "config-change", detail: "touched config.ts" },
    ]
    const lesson: RelevantLesson = { id: "L42", title: "fix X for error Y", advice: "warn", confidence: 0.6, concepts: ["bash"] }
    const slot: SlotMemory = { consecutiveStops: 3, consecutiveContinues: 0, lastUpdatedISO: "2026-06-09T00:00:00.000Z" }
    const modes: readonly AmbientContext["mode"][] = ["ultrawork", "ulw", "simple", "ralph-loop"]

    // when
    const severities = new Set(deviations.map((deviation) => deviation.severity))

    // then
    expect(evidence.confidence).toBeGreaterThan(0.9)
    expect(sources).toHaveLength(8)
    expect(severities).toEqual(new Set(["leve", "media", "grave"]))
    expect(lesson.concepts).toContain("bash")
    expect(slot.consecutiveStops).toBeGreaterThanOrEqual(3)
    expect(modes).toContain("ralph-loop")
  })
})
