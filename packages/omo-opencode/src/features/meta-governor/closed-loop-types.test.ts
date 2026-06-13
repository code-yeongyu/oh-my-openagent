/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type {
  AgentmemoryWriteBackend,
  ClosedLoopConfig,
  LearnFromOutcomeInput,
  LearnFromOutcomeOutput,
  LessonLearned,
  MemoryDecision,
} from "./types"

describe("meta-governor closed-loop types", () => {
  test("configure when the learner writes lessons and decisions", () => {
    // given
    const config: ClosedLoopConfig = {
      enabled: true,
      minSeverityToLearn: "media",
      maxLessonsPerSession: 20,
      saveDecisions: true,
    }
    const levels: readonly ClosedLoopConfig["minSeverityToLearn"][] = ["leve", "media", "grave"]

    // when
    const acceptsMedia = levels.includes(config.minSeverityToLearn)

    // then
    expect(acceptsMedia).toBe(true)
    expect(config.saveDecisions).toBe(true)
  })

  test("record decisions and learned lessons with audit fields", () => {
    // given
    const decision: MemoryDecision = {
      id: "D-abc123",
      timestampISO: "2026-06-09T12:00:00.000Z",
      action: "warn",
      score: -0.5,
      reasoning: "deviation detected",
      sessionID: "ses_test",
      directory: "/tmp/test",
      deviations: [{ severity: "media", category: "lint", detail: "style" }],
    }
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
    const hasAuditTrail = decision.sessionID === lesson.sessionID && lesson.files.length === 1

    // then
    expect(decision.action).toBe("warn")
    expect(lesson.type).toBe("pattern")
    expect(hasAuditTrail).toBe(true)
  })

  test("define write and observe ports for closed-loop learning", async () => {
    // given
    const writeBackend: AgentmemoryWriteBackend = {
      saveMemory: async () => ({ id: "mem-1" }),
      saveLesson: async () => ({ id: "les-1" }),
    }
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
    const output: LearnFromOutcomeOutput = {
      lessonSaved: null,
      decisionSaved: null,
      reason: "no action",
    }

    // when
    const [memory, lesson] = await Promise.all([
      writeBackend.saveMemory({ content: "content", concepts: ["meta"], type: "pattern" }),
      writeBackend.saveLesson({ content: "content", context: input.sessionID }),
    ])

    // then
    expect(memory.id).toBe("mem-1")
    expect(lesson.id).toBe("les-1")
    expect(output.reason).toBe("no action")
  })
})
