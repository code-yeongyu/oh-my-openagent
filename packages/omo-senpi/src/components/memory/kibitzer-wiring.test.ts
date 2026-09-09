import { describe, expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemoryIdentityContext } from "./context"
import { createKibitzerGateWiring } from "./kibitzer-wiring"

const context = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-kibitzer-wiring", "agent"),
  binding: { identity: "agent", repoPathHash: "hash", boundAt: 0 },
})
const collected = { sessionId: "session-1", context, candidates: [], surfaced: new Set<string>(), maxItems: 2, transcript: [] }

describe("createKibitzerGateWiring", () => {
  test("#given skipped outcomes #when reported repeatedly #then one gate entry is appended per session and cause", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "skipped", cause: "quick_unavailable" }, collected)
    gate.reportOutcome("session-1", { status: "skipped", cause: "quick_unavailable" }, collected)
    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken" }, collected)

    expect(entries).toHaveLength(2)
    expect(entries[0]?.data).toEqual({ version: 1, status: "skipped", cause: "quick_unavailable", candidateCount: 0 })
  })

  test("#given a dropped deadline outcome #when reported #then an omo-kibitzer:gate record is appended", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "dropped", cause: "deadline" }, collected)

    expect(entries).toEqual([{
      customType: "omo-kibitzer:gate",
      data: { version: 1, status: "dropped", cause: "deadline", candidateCount: 0 },
    }])
  })

  test("#given a dropped outcome that names the judged model #when reported #then the gate record carries that model", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "dropped", cause: "compaction", model: "omo-mock/healthy-fallback", runId: "run-1" }, collected)

    expect(entries).toEqual([{
      customType: "omo-kibitzer:gate",
      data: { version: 1, status: "dropped", cause: "compaction", model: "omo-mock/healthy-fallback", candidateCount: 0, runId: "run-1" },
    }])
  })

  test("#given a session epoch #when compaction is accepted #then the epoch increments and shutdown drains the runner", async () => {
    let cancelled = 0
    let idle = 0
    const gate = createKibitzerGateWiring({
      resolveContext: () => context,
      runnerFor: () => ({
        launch: async () => ({ status: "empty" }),
        cancel: async () => { cancelled += 1 },
        whenIdle: async () => { idle += 1 },
      }),
    })

    expect(gate.currentCompactionEpoch("session-1")).toBe(0)
    gate.onCompactionAccepted("session-1")
    expect(gate.currentCompactionEpoch("session-1")).toBe(1)
    await gate.onSessionShutdown("session-1")

    expect({ cancelled, idle }).toEqual({ cancelled: 1, idle: 1 })
    expect(gate.currentCompactionEpoch("session-1")).toBe(0)
  })
})
