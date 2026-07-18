/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { AgentMemoryRead, BoulderStateRead, MagicContextRead, MemoryBackends, MemoryRead, MemorySource } from "./types"

describe("meta-governor memory types", () => {
  test("aggregate all memory sources with degraded-source tracking", () => {
    // given
    const read: MemoryRead = {
      query: "ralph-loop continue after config-change",
      timestampISO: "2026-06-09T12:00:00.000Z",
      agentmemory: {
        available: true,
        lessons: [{ id: "L1", title: "stop on grave config-change", advice: "stop", confidence: 0.7, concepts: ["config-change"] }],
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
    const degradedSource = read.degradedSources[0]

    // then
    expect(read.agentmemory.available).toBe(true)
    expect(read.boulderState.available).toBe(false)
    expect(degradedSource).toBe<MemorySource>("boulderState")
  })

  test("represent unavailable read backends with explicit error messages", () => {
    // given
    const agentmemory: AgentMemoryRead = {
      available: false,
      lessons: [],
      errorMessage: "agentmemory MCP not connected",
    }
    const magicContext: MagicContextRead = {
      available: false,
      slots: [],
      errorMessage: "magic-context slot not initialised",
    }
    const boulderState: BoulderStateRead = {
      available: true,
      tasks: [{ id: "T1", status: "done", title: "fix bug" }],
      planProgress: 0.5,
    }

    // when
    const planProgressInRange = boulderState.planProgress >= 0 && boulderState.planProgress <= 1

    // then
    expect(agentmemory.errorMessage).toContain("agentmemory")
    expect(magicContext.errorMessage).toContain("magic-context")
    expect(planProgressInRange).toBe(true)
  })

  test("define dependency-injection ports for the memory aggregator", async () => {
    // given
    const backends: MemoryBackends = {
      agentmemory: {
        smartSearch: async () => ({
          lessons: [{ title: "lesson", content: "content", type: "pattern", confidence: 0.8 }],
          crystals: [],
        }),
      },
      magicContext: {
        slotList: async () => [{ label: "meta_state", content: "{}" }],
      },
      boulderState: {
        boulderRead: async () => [{ id: "T1", title: "task", priority: 1, status: "done", createdAtMs: 1, updatedAtMs: 2 }],
      },
    }

    // when
    const [lessons, slots, tasks] = await Promise.all([
      backends.agentmemory.smartSearch({ query: "lesson" }),
      backends.magicContext.slotList({ labelPrefix: "meta" }),
      backends.boulderState.boulderRead({ directory: "/tmp", sessionID: "ses" }),
    ])

    // then
    expect(lessons.lessons[0]?.title).toBe("lesson")
    expect(slots[0]?.label).toBe("meta_state")
    expect(tasks[0]?.status).toBe("done")
  })
})
