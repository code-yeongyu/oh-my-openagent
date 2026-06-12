import { describe, expect, test, mock, beforeEach } from "bun:test"
import type {
  AgentmemoryWriteBackend,
  ClosedLoopConfig,
  Decision,
  LearnFromOutcomeInput,
} from "./types"
import { observeAndLearn, defaultClosedLoopConfig, SEVERITY_ORDER } from "./closed-loop-learning"

// --- Helpers ---

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    action: "warn",
    score: -0.4,
    reasoning: "test reasoning",
    evidence: [
      { source: "deviation-detector", value: "config-change", confidence: 0.8, weight: 0.5 },
    ],
    shouldEscalateTo: null,
    ...overrides,
  }
}

function makeInput(overrides: Partial<LearnFromOutcomeInput> = {}): LearnFromOutcomeInput {
  return {
    decision: makeDecision(),
    memoryRead: {
      query: "test",
      timestampISO: "2026-06-09T12:00:00.000Z",
      agentmemory: { available: true, lessons: [] },
      magicContext: { available: true, slots: [] },
      boulderState: { available: true, tasks: [], planProgress: 0 },
      degradedSources: [],
    },
    config: defaultClosedLoopConfig(),
    sessionID: "ses_test",
    directory: "/tmp/test",
    filesChanged: ["src/foo.ts"],
    ...overrides,
  }
}

function makeBackend(overrides: Partial<AgentmemoryWriteBackend> = {}): AgentmemoryWriteBackend {
  return {
    saveMemory: mock(() => Promise.resolve({ id: "mem-1" })),
    saveLesson: mock(() => Promise.resolve({ id: "les-1" })),
    ...overrides,
  }
}

describe("closed-loop-learning", () => {
  describe("observeAndLearn", () => {
    test("CL1: saves lesson when deviation meets severity threshold (media)", async () => {
      // given
      const backend = makeBackend()
      const input = makeInput()

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.lessonSaved).not.toBeNull()
      expect(result.lessonSaved!.type).toBe("pattern")
      expect(result.lessonSaved!.sessionID).toBe("ses_test")
      expect(result.lessonSaved!.concepts).toContain("deviation-detector")
      expect(backend.saveLesson).toHaveBeenCalledTimes(1)
    })

    test("CL2: saves decision record when saveDecisions=true", async () => {
      // given
      const backend = makeBackend()
      const input = makeInput({ config: { ...defaultClosedLoopConfig(), saveDecisions: true } })

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.decisionSaved).not.toBeNull()
      expect(result.decisionSaved!.action).toBe("warn")
      expect(result.decisionSaved!.sessionID).toBe("ses_test")
      expect(backend.saveMemory).toHaveBeenCalledTimes(1)
    })

    test("CL3: skips lesson when severity below threshold (leve < media)", async () => {
      // given
      const backend = makeBackend()
      const input = makeInput({
        decision: makeDecision({
          evidence: [
            { source: "deviation-detector", value: "lint", confidence: 0.5, weight: 0.3 },
          ],
        }),
        config: { ...defaultClosedLoopConfig(), minSeverityToLearn: "grave", saveDecisions: false },
      })

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.lessonSaved).toBeNull()
      expect(result.reason).toContain("severity below threshold")
      expect(backend.saveLesson).toHaveBeenCalledTimes(0)
    })

    test("CL4: returns no-op when config.enabled=false", async () => {
      // given
      const backend = makeBackend()
      const input = makeInput({ config: { ...defaultClosedLoopConfig(), enabled: false } })

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.lessonSaved).toBeNull()
      expect(result.decisionSaved).toBeNull()
      expect(result.reason).toContain("disabled")
      expect(backend.saveMemory).toHaveBeenCalledTimes(0)
      expect(backend.saveLesson).toHaveBeenCalledTimes(0)
    })

    test("CL5: returns no-op when action=continue and no evidence", async () => {
      // given
      const backend = makeBackend()
      const input = makeInput({
        decision: makeDecision({ action: "continue", score: 0.5, evidence: [] }),
      })

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.lessonSaved).toBeNull()
      expect(result.decisionSaved).toBeNull()
      expect(result.reason).toContain("no deviations")
    })

    test("CL6: degrades silently when backend.saveLesson throws", async () => {
      // given
      const backend = makeBackend({
        saveLesson: mock(() => Promise.reject(new Error("MCP down"))),
      })
      const input = makeInput({ config: { ...defaultClosedLoopConfig(), saveDecisions: false } })

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.lessonSaved).toBeNull()
      expect(result.reason).toContain("no saveable content")
    })

    test("CL7: degrades silently when backend.saveMemory throws", async () => {
      // given
      const backend = makeBackend({
        saveMemory: mock(() => Promise.reject(new Error("MCP down"))),
      })
      const input = makeInput()

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.decisionSaved).toBeNull()
      // lesson may still succeed if saveMemory fails first
    })

    test("CL8: skip decision save when saveDecisions=false", async () => {
      // given
      const backend = makeBackend()
      const input = makeInput({ config: { ...defaultClosedLoopConfig(), saveDecisions: false } })

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.decisionSaved).toBeNull()
      expect(backend.saveMemory).toHaveBeenCalledTimes(0)
      // lesson should still be saved
      expect(result.lessonSaved).not.toBeNull()
    })

    test("CL9: extracts file paths from filesChanged into lesson", async () => {
      // given
      const backend = makeBackend()
      const input = makeInput({ filesChanged: ["src/a.ts", "src/b.ts"] })

      // when
      const result = await observeAndLearn(input, backend)

      // then
      expect(result.lessonSaved).not.toBeNull()
      expect(result.lessonSaved!.files).toEqual(["src/a.ts", "src/b.ts"])
    })
  })

  describe("defaultClosedLoopConfig", () => {
    test("DCC1: returns sensible defaults", () => {
      const cfg = defaultClosedLoopConfig()
      expect(cfg.enabled).toBe(true)
      expect(cfg.minSeverityToLearn).toBe("media")
      expect(cfg.maxLessonsPerSession).toBe(20)
      expect(cfg.saveDecisions).toBe(true)
    })
  })

  describe("SEVERITY_ORDER", () => {
    test("SO1: leve < media < grave ordering", () => {
      expect(SEVERITY_ORDER.leve).toBeLessThan(SEVERITY_ORDER.media)
      expect(SEVERITY_ORDER.media).toBeLessThan(SEVERITY_ORDER.grave)
    })
  })
})
