/**
 * Tests for PostRepairRecorder — PR 9 of 9.
 *
 * Given/When/Then style with bun:test.
 * Tests verify that recordRecovery() correctly maps recovery outcomes
 * to lessons via agentmemory, with proper degradation when backend is null.
 *
 * Severity mapping:
 * - success=true  → leve (0) — below default media threshold → decision only
 * - success=false → grave (2) — meets default media threshold → lesson + decision
 */

import { describe, expect, test } from "bun:test"
import { recordRecovery, defaultClosedLoopConfig, type RecoveryOutcome } from "./post-repair-recorder"

// ─── Mock Backend ──────────────────────────────────────────────────

function createMockBackend(): AgentmemoryWriteBackend & {
  memorySaved: Array<{ content: string; concepts: string[]; type: string }>
  lessonsSaved: Array<{ content: string; context: string; confidence?: number; tags?: string[] }>
} {
  const state = {
    memorySaved: [] as Array<{ content: string; concepts: string[]; type: string }>,
    lessonsSaved: [] as Array<{ content: string; context: string; confidence?: number; tags?: string[] }>,
  }

  return {
    ...state,
    async saveMemory(input) {
      state.memorySaved.push(input)
      return { id: `mem-${state.memorySaved.length}` }
    },
    async saveLesson(input) {
      state.lessonsSaved.push(input)
      return { id: `les-${state.lessonsSaved.length}` }
    },
  }
}

function createBaseOutcome(overrides?: Partial<RecoveryOutcome>): RecoveryOutcome {
  return {
    errorCode: "TOOL_TIMEOUT",
    fixStrategy: "retry",
    success: true,
    sessionID: "ses-test-123",
    directory: "/tmp/test-project",
    filesChanged: ["src/foo.ts"],
    context: "bash command timed out after 30s",
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("PostRepairRecorder", () => {
  describe("#recordRecovery", () => {
    describe("when writeBackend is null", () => {
      test("returns null without throwing", async () => {
        const result = await recordRecovery(createBaseOutcome(), null)
        expect(result).toBeNull()
      })
    })

    describe("when config is disabled", () => {
      test("returns lessonSaved null with reason", async () => {
        const backend = createMockBackend()
        const config: ClosedLoopConfig = { ...defaultClosedLoopConfig(), enabled: false }

        const result = await recordRecovery(createBaseOutcome(), backend, { config })

        expect(result).not.toBeNull()
        expect(result!.lessonSaved).toBeNull()
        expect(result!.reason).toContain("disabled")
      })
    })

    describe("when recovery succeeds (leve severity)", () => {
      test("does NOT save lesson (leve < media threshold) but saves decision", async () => {
        const backend = createMockBackend()
        const outcome = createBaseOutcome({ success: true })

        const result = await recordRecovery(outcome, backend)

        expect(result).not.toBeNull()
        expect(result!.lessonSaved).toBeNull()
        expect(result!.decisionSaved).not.toBeNull()
        expect(result!.decisionSaved!.action).toBe("continue")
        expect(result!.decisionSaved!.score).toBe(0.5)
        expect(result!.reason).toContain("decision saved")
      })

      test("saves a decision record when saveDecisions is true", async () => {
        const backend = createMockBackend()
        const config: ClosedLoopConfig = { ...defaultClosedLoopConfig(), saveDecisions: true }

        const result = await recordRecovery(createBaseOutcome({ success: true }), backend, { config })

        expect(result!.decisionSaved).not.toBeNull()
        expect(result!.decisionSaved!.action).toBe("continue")
        expect(result!.decisionSaved!.score).toBe(0.5)
      })

      test("does not save decision when saveDecisions is false", async () => {
        const backend = createMockBackend()
        const config: ClosedLoopConfig = { ...defaultClosedLoopConfig(), saveDecisions: false }

        const result = await recordRecovery(createBaseOutcome({ success: true }), backend, { config })

        expect(result!.decisionSaved).toBeNull()
      })
    })

    describe("when recovery fails (grave severity)", () => {
      test("saves both lesson and decision", async () => {
        const backend = createMockBackend()
        const outcome = createBaseOutcome({ success: false })

        const result = await recordRecovery(outcome, backend)

        expect(result).not.toBeNull()
        expect(result!.lessonSaved).not.toBeNull()
        expect(result!.lessonSaved!.type).toBe("pattern")
        expect(result!.lessonSaved!.content).toContain("failed")
        expect(result!.decisionSaved).not.toBeNull()
        expect(result!.decisionSaved!.action).toBe("warn")
        expect(result!.decisionSaved!.score).toBe(-0.5)
      })

      test("lesson concepts contain recovery category and grave severity", async () => {
        const backend = createMockBackend()

        await recordRecovery(createBaseOutcome({ success: false }), backend)

        expect(backend.lessonsSaved.length).toBe(1)
        expect(backend.lessonsSaved[0].tags).toContain("recovery:retry")
        expect(backend.lessonsSaved[0].tags).toContain("grave")
      })

      test("includes errorCode in lesson content", async () => {
        const backend = createMockBackend()
        const outcome = createBaseOutcome({
          success: false,
          errorCode: "JSON_PARSE_ERROR",
          context: "malformed JSON from tool output",
        })

        const result = await recordRecovery(outcome, backend)

        expect(result!.lessonSaved!.content).toContain("JSON_PARSE_ERROR")
        expect(result!.lessonSaved!.content).toContain("malformed JSON")
      })
    })

    describe("severity threshold", () => {
      test("grave recovery always saves lesson (grave >= media default)", async () => {
        const backend = createMockBackend()
        const outcome = createBaseOutcome({ success: false }) // grave

        const result = await recordRecovery(outcome, backend)

        expect(result!.lessonSaved).not.toBeNull()
      })

      test("leve recovery with grave threshold does NOT save lesson", async () => {
        const backend = createMockBackend()
        const config: ClosedLoopConfig = { ...defaultClosedLoopConfig(), minSeverityToLearn: "grave" }
        const outcome = createBaseOutcome({ success: true }) // leve

        const result = await recordRecovery(outcome, backend, { config })

        expect(result!.lessonSaved).toBeNull()
        expect(result!.reason).toContain("severity below threshold")
      })

      test("grave recovery with grave threshold saves lesson", async () => {
        const backend = createMockBackend()
        const config: ClosedLoopConfig = { ...defaultClosedLoopConfig(), minSeverityToLearn: "grave" }
        const outcome = createBaseOutcome({ success: false }) // grave

        const result = await recordRecovery(outcome, backend, { config })

        expect(result!.lessonSaved).not.toBeNull()
      })
    })

    describe("backend integration", () => {
      test("calls saveLesson with correct context on failure", async () => {
        const backend = createMockBackend()
        const outcome = createBaseOutcome({ success: false, sessionID: "ses-abc", directory: "/tmp/proj" })

        await recordRecovery(outcome, backend)

        expect(backend.lessonsSaved.length).toBe(1)
        expect(backend.lessonsSaved[0].context).toContain("ses-abc")
        expect(backend.lessonsSaved[0].context).toContain("/tmp/proj")
      })

      test("calls saveMemory when saveDecisions is true", async () => {
        const backend = createMockBackend()

        await recordRecovery(createBaseOutcome(), backend)

        expect(backend.memorySaved.length).toBe(1)
        expect(backend.memorySaved[0].type).toBe("fact")
      })

      test("does not call saveMemory when saveDecisions is false", async () => {
        const backend = createMockBackend()
        const config: ClosedLoopConfig = { ...defaultClosedLoopConfig(), saveDecisions: false }

        await recordRecovery(createBaseOutcome(), backend, { config })

        expect(backend.memorySaved.length).toBe(0)
      })
    })

    describe("edge cases", () => {
      test("missing filesChanged defaults to empty array", async () => {
        const backend = createMockBackend()
        const outcome = createBaseOutcome({ success: false, filesChanged: undefined })

        const result = await recordRecovery(outcome, backend)

        expect(result!.lessonSaved).not.toBeNull()
        expect(result!.lessonSaved!.files).toEqual([])
      })

      test("missing context defaults to 'no context'", async () => {
        const backend = createMockBackend()
        const outcome = createBaseOutcome({ success: false, context: undefined })

        const result = await recordRecovery(outcome, backend)

        expect(result!.lessonSaved!.content).toContain("no context")
      })

      test("different fixStrategy maps to different recovery category", async () => {
        const backend = createMockBackend()

        await recordRecovery(createBaseOutcome({ success: false, fixStrategy: "retry" }), backend)
        await recordRecovery(createBaseOutcome({ success: false, fixStrategy: "compact" }), backend)

        expect(backend.lessonsSaved[0].tags).toContain("recovery:retry")
        expect(backend.lessonsSaved[1].tags).toContain("recovery:compact")
      })
    })
  })
})
