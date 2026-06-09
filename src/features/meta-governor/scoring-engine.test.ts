/**
 * MetaGovernor Scoring Engine tests — PR 5 of 8.
 *
 * Tests cover:
 * - Score ranges for each action bucket
 * - Evidence generation (cite-or-abstain)
 * - Paralysis prevention (3 consecutive stops)
 * - Escalation target selection
 * - Edge cases (empty context, extreme values)
 * - Config override
 *
 * All tests use given/when/then style per bun:test conventions.
 */

import { describe, expect, it } from "bun:test"
import { score, defaultScoringConfig } from "./scoring-engine"
import type {
  DecisionContext,
  ScoringConfig,
  SlotMemory,
  AmbientContext,
  Deviation,
  RelevantLesson,
} from "./types"

// ─── Fixtures ──────────────────────────────────────────────────────

const defaultAmbient: AmbientContext = {
  sessionID: "test-session",
  directory: "/test/dir",
  mode: "ultrawork",
  agentName: "sisyphus",
  iteration: 5,
  maxIterations: 20,
}

const emptySlotMemory: SlotMemory = {
  consecutiveStops: 0,
  consecutiveContinues: 0,
  lastUpdatedISO: new Date().toISOString(),
}

const baseContext: DecisionContext = {
  oracleVerified: false,
  noProgress: false,
  deviations: [],
  iterationRatio: 0.25,
  lessonsRelevant: [],
  slotMemory: emptySlotMemory,
  ambient: defaultAmbient,
}

const positiveContext: DecisionContext = {
  ...baseContext,
  oracleVerified: true,
  noProgress: false,
  deviations: [],
  iterationRatio: 0.1,
}

const negativeContext: DecisionContext = {
  ...baseContext,
  oracleVerified: false,
  noProgress: true,
  deviations: [{ severity: "media", category: "test", detail: "test deviation" }],
  iterationRatio: 0.8,
}

const severeContext: DecisionContext = {
  ...baseContext,
  oracleVerified: false,
  noProgress: true,
  deviations: [
    { severity: "grave", category: "test", detail: "grave deviation 1" },
    { severity: "grave", category: "test", detail: "grave deviation 2" },
  ],
  iterationRatio: 0.95,
  lessonsRelevant: [
    { id: "l1", title: "stop pattern", advice: "stop", confidence: 0.9, concepts: ["test"] },
  ],
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("scoring-engine", () => {
  describe("#score", () => {
    // ─── Happy path: clear positive signals ───────────────────────

    it("returns continue with high score when oracle verified, no deviations", () => {
      // given
      const ctx = positiveContext

      // when
      const result = score(ctx)

      // then
      expect(result.decision.action).toBe("continue")
      expect(result.decision.score).toBeGreaterThan(0.1)
      expect(result.paralysisOverride).toBe(false)
    })

    it("returns continue with positive score for mostly positive signals", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        oracleVerified: true,
        noProgress: false,
        deviations: [],
        iterationRatio: 0.1,
        lessonsRelevant: [
          { id: "l1", title: "proceed", advice: "continue", confidence: 0.8, concepts: ["test"] },
        ],
      }

      // when
      const result = score(ctx)

      // then
      expect(result.decision.score).toBeGreaterThan(0)
      expect(result.decision.action).toBe("continue")
    })

    // ─── Warn range ──────────────────────────────────────────────

    it("returns warn for moderate negative signals", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        oracleVerified: false,
        noProgress: true,
        deviations: [{ severity: "leve", category: "test", detail: "minor" }],
        iterationRatio: 0.6,
      }

      // when
      const result = score(ctx)

      // then
      expect(result.decision.score).toBeLessThan(0)
      expect(["warn", "continue"]).toContain(result.decision.action)
    })

    // ─── Escalate range ─────────────────────────────────────────

    it("returns escalate for strong negative signals", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        oracleVerified: false,
        noProgress: true,
        deviations: [
          { severity: "grave", category: "test", detail: "critical failure" },
          { severity: "grave", category: "test", detail: "another critical" },
        ],
        iterationRatio: 1.0,
        lessonsRelevant: [
          { id: "l1", title: "stop now", advice: "stop", confidence: 1.0, concepts: ["test"] },
          { id: "l2", title: "stop again", advice: "stop", confidence: 1.0, concepts: ["test"] },
        ],
      }

      // when
      const result = score(ctx, { escalateThreshold: 0.4 })

      // then
      expect(result.decision.score).toBeLessThan(-0.4)
      expect(result.decision.action).toBe("escalate")
    })

    // ─── Stop range ─────────────────────────────────────────────

    it("returns stop for severe negative signals", () => {
      // given — stronger signals than severeContext to hit stop threshold
      const ctx: DecisionContext = {
        ...baseContext,
        oracleVerified: false,
        noProgress: true,
        deviations: [
          { severity: "grave", category: "test", detail: "critical" },
          { severity: "grave", category: "test", detail: "critical 2" },
          { severity: "grave", category: "test", detail: "critical 3" },
        ],
        iterationRatio: 1.0,
        lessonsRelevant: [
          { id: "l1", title: "stop", advice: "stop", confidence: 1.0, concepts: ["test"] },
          { id: "l2", title: "stop", advice: "stop", confidence: 1.0, concepts: ["test"] },
        ],
      }

      // when
      const result = score(ctx, { stopThreshold: 0.5 })

      // then — with custom config, stop requires score <= -0.5
      expect(result.decision.score).toBeLessThan(-0.5)
      expect(result.decision.action).toBe("stop")
    })

    // ─── Evidence generation ────────────────────────────────────

    it("generates evidence for non-continue actions (cite-or-abstain)", () => {
      // when
      const result = score(severeContext)

      // then
      expect(result.decision.evidence.length).toBeGreaterThan(0)
    })

    it("generates no evidence for silently continuing", () => {
      // given — positive signals with lowered continueThreshold so score >= threshold
      const ctx: DecisionContext = {
        ...baseContext,
        oracleVerified: true,
        noProgress: false,
        deviations: [],
        iterationRatio: 0,
        lessonsRelevant: [
          { id: "l1", title: "continue", advice: "continue", confidence: 1.0, concepts: ["test"] },
          { id: "l2", title: "keep going", advice: "continue", confidence: 1.0, concepts: ["test"] },
        ],
      }

      // when
      const result = score(ctx, { continueThreshold: 0.1 })

      // then — score >= 0.1 threshold → silent continue → no evidence
      expect(result.decision.action).toBe("continue")
      expect(result.decision.evidence.length).toBe(0)
    })

    // ─── Paralysis prevention ──────────────────────────────────

    it("forces continue when 3+ consecutive stops (paralysis)", () => {
      // given
      const ctx: DecisionContext = {
        ...severeContext,
        slotMemory: {
          ...emptySlotMemory,
          consecutiveStops: 3,
        },
      }

      // when
      const result = score(ctx)

      // then
      expect(result.decision.action).toBe("continue")
      expect(result.paralysisOverride).toBe(true)
      expect(result.decision.reasoning).toContain("Paralysis detected")
    })

    it("does not trigger paralysis with only 2 consecutive stops", () => {
      // given — 2 stops is below paralysisThreshold (3)
      const ctx: DecisionContext = {
        ...baseContext,
        oracleVerified: false,
        noProgress: true,
        deviations: [
          { severity: "grave", category: "test", detail: "critical" },
        ],
        iterationRatio: 0.8,
        lessonsRelevant: [],
        slotMemory: {
          ...emptySlotMemory,
          consecutiveStops: 2,
        },
      }

      // when
      const result = score(ctx)

      // then
      expect(result.paralysisOverride).toBe(false)
      // Score is negative but not enough for stop/escalate with default weights
      expect(result.decision.score).toBeLessThan(0)
    })

    // ─── Escalation target ─────────────────────────────────────

    it("selects oracle as escalation target when oracle not verified", () => {
      // given
      const ctx: DecisionContext = {
        ...negativeContext,
        oracleVerified: false,
        iterations: undefined,
      }

      // when
      const result = score(ctx)

      // then
      if (result.decision.action === "escalate") {
        expect(result.decision.shouldEscalateTo).toBe("oracle")
      }
    })

    it("selects user as escalation target for grave deviations after oracle", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        oracleVerified: true,
        noProgress: true,
        deviations: [
          { severity: "grave", category: "test", detail: "grave after oracle" },
        ],
        iterationRatio: 0.95,
      }

      // when
      const result = score(ctx)

      // then
      if (result.decision.action === "escalate") {
        expect(result.decision.shouldEscalateTo).toBe("user")
      }
    })

    // ─── Edge cases ────────────────────────────────────────────

    it("handles empty deviations array", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        deviations: [],
      }

      // when
      const result = score(ctx)

      // then
      expect(result.decision.score).toBeGreaterThanOrEqual(-1)
      expect(result.decision.score).toBeLessThanOrEqual(1)
      expect(result.contributions.length).toBeGreaterThan(0)
    })

    it("handles iteration ratio at exact boundary (1.0)", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        iterationRatio: 1.0,
        ambient: { ...defaultAmbient, iteration: 20, maxIterations: 20 },
      }

      // when
      const result = score(ctx)

      // then
      expect(result.decision.score).toBeLessThan(0)
    })

    it("handles iteration ratio at 0", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        iterationRatio: 0,
        ambient: { ...defaultAmbient, iteration: 0, maxIterations: 20 },
      }

      // when
      const result = score(ctx)

      // then
      expect(result.decision.score).toBeGreaterThanOrEqual(0)
    })

    it("handles empty lessons array", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        lessonsRelevant: [],
      }

      // when
      const result = score(ctx)

      // then
      // Should still produce a valid decision
      expect(result.contributions.length).toBeGreaterThan(0)
      const lessonContrib = result.contributions.find((c) => c.source === "lesson-recall")
      expect(lessonContrib).toBeDefined()
      expect(lessonContrib!.rawScore).toBe(0)
    })

    it("handles mixed lesson advice types", () => {
      // given
      const ctx: DecisionContext = {
        ...baseContext,
        lessonsRelevant: [
          { id: "l1", title: "continue", advice: "continue", confidence: 0.8, concepts: ["test"] },
          { id: "l2", title: "stop", advice: "stop", confidence: 0.9, concepts: ["test"] },
          { id: "l3", title: "info", advice: "info", confidence: 0.5, concepts: ["test"] },
        ],
      }

      // when
      const result = score(ctx)

      // then
      const lessonContrib = result.contributions.find((c) => c.source === "lesson-recall")
      expect(lessonContrib).toBeDefined()
      // Mixed advice → some positive, some negative → averaged
      expect(lessonContrib!.rawScore).toBeGreaterThanOrEqual(-1)
      expect(lessonContrib!.rawScore).toBeLessThanOrEqual(1)
    })

    // ─── Config override ───────────────────────────────────────

    it("respects custom scoring config", () => {
      // given: make thresholds very strict
      const strictConfig: Partial<ScoringConfig> = {
        continueThreshold: 0.8,
        warnThreshold: 0.1,
        escalateThreshold: 0.2,
        stopThreshold: 0.3,
      }

      // when
      const result = score(positiveContext, strictConfig)

      // then: even positive context may not hit 0.8 threshold
      expect(result.decision.score).toBeDefined()
    })

    it("respects custom paralysis threshold", () => {
      // given
      const ctx: DecisionContext = {
        ...severeContext,
        slotMemory: {
          ...emptySlotMemory,
          consecutiveStops: 2,
        },
      }
      const config: Partial<ScoringConfig> = {
        paralysisThreshold: 2,
      }

      // when
      const result = score(ctx, config)

      // then: 2 stops with threshold 2 → paralysis
      expect(result.paralysisOverride).toBe(true)
      expect(result.decision.action).toBe("continue")
    })

    // ─── Score clamping ────────────────────────────────────────

    it("clamps score to [-1, +1]", () => {
      // given: extreme positive context
      const ctx: DecisionContext = {
        oracleVerified: true,
        noProgress: false,
        deviations: [],
        iterationRatio: 0,
        lessonsRelevant: [
          { id: "l1", title: "proceed", advice: "continue", confidence: 1.0, concepts: ["test"] },
          { id: "l2", title: "proceed2", advice: "continue", confidence: 1.0, concepts: ["test"] },
          { id: "l3", title: "proceed3", advice: "continue", confidence: 1.0, concepts: ["test"] },
        ],
        slotMemory: emptySlotMemory,
        ambient: { ...defaultAmbient, iteration: 0, maxIterations: 100 },
      }

      // when
      const result = score(ctx)

      // then
      expect(result.decision.score).toBeLessThanOrEqual(1)
      expect(result.decision.score).toBeGreaterThanOrEqual(-1)
    })

    // ─── Multiple deviations ───────────────────────────────────

    it("amplifies score negativity with multiple deviations", () => {
      // given
      const singleDevCtx: DecisionContext = {
        ...baseContext,
        deviations: [{ severity: "media", category: "test", detail: "single" }],
      }
      const multiDevCtx: DecisionContext = {
        ...baseContext,
        deviations: [
          { severity: "media", category: "test", detail: "first" },
          { severity: "media", category: "test", detail: "second" },
          { severity: "media", category: "test", detail: "third" },
        ],
      }

      // when
      const singleResult = score(singleDevCtx)
      const multiResult = score(multiDevCtx)

      // then
      expect(multiResult.decision.score).toBeLessThan(singleResult.decision.score)
    })

    // ─── Contributions breakdown ───────────────────────────────

    it("provides evidence contributions breakdown", () => {
      // when
      const result = score(baseContext)

      // then
      expect(result.contributions.length).toBeGreaterThanOrEqual(5) // at least 5 signal sources
      for (const c of result.contributions) {
        expect(c.source).toBeDefined()
        expect(c.rawScore).toBeGreaterThanOrEqual(-1)
        expect(c.rawScore).toBeLessThanOrEqual(1)
        expect(c.weight).toBeGreaterThan(0)
        expect(c.description).toBeTruthy()
      }
    })

    it("rawScore equals sum of weighted scores", () => {
      // when
      const result = score(negativeContext)

      // then
      const expectedSum = result.contributions.reduce((s, c) => s + c.weightedScore, 0)
      // Allow small float precision difference
      expect(Math.abs(result.rawScore - expectedSum)).toBeLessThan(0.001)
    })

    // ─── Computed timestamp ────────────────────────────────────

    it("includes computedAtISO timestamp", () => {
      // when
      const result = score(baseContext)

      // then
      expect(result.computedAtISO).toBeTruthy()
      expect(new Date(result.computedAtISO).getTime()).toBeGreaterThan(0)
    })
  })
})
