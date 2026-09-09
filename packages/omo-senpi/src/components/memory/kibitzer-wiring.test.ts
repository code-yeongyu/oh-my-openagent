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

function notices(entries: readonly { data: unknown }[]): readonly { data: unknown }[] {
  return entries.filter(({ data }) => typeof data === "object" && data !== null
    && "consecutiveFailures" in data && typeof data.consecutiveFailures === "number")
}

describe("createKibitzerGateWiring", () => {
  test("#given one failed gate outcome #when reported #then it records the failure without appending a user notice", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken", runId: "run-1" }, collected)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.data).toMatchObject({ status: "failed", cause: "child_failed", runId: "run-1" })
    expect(notices(entries)).toHaveLength(0)
  })

  test("#given repeated failed gate outcomes #when the persistence threshold is reached #then one actionable notice is appended", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken", runId: "run-1" }, collected)
    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken", runId: "run-2" }, collected)
    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken", runId: "run-3" }, collected)

    expect(entries).toHaveLength(3)
    expect(notices(entries)).toHaveLength(1)
    expect(entries[2]?.data).toMatchObject({
      version: 1,
      status: "failed",
      cause: "child_failed",
      reason: "broken",
      runId: "run-3",
      consecutiveFailures: 3,
    })
  })

  test("#given a notified failure streak #when another failure occurs during notification cooldown #then no duplicate notice is appended", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    for (const runId of ["run-1", "run-2", "run-3", "run-4"]) {
      gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken", runId }, collected)
    }

    expect(entries).toHaveLength(4)
    expect(notices(entries)).toHaveLength(1)
  })

  test("#given a failed gate streak #when the gate completes normally #then the next failure starts a fresh streak", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed" }, collected)
    gate.resetFailureStreak("session-1")
    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed" }, collected)

    expect(entries).toHaveLength(2)
    expect(notices(entries)).toHaveLength(0)
  })

  test("#given repeated diagnostic outcomes #when reported #then one gate entry is appended at the persistence threshold", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "skipped", cause: "quick_unavailable" }, collected)
    gate.reportOutcome("session-1", { status: "skipped", cause: "quick_unavailable" }, collected)
    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken" }, collected)

    expect(entries).toHaveLength(3)
    expect(notices(entries)).toHaveLength(1)
    expect(entries[2]?.data).toEqual({
      version: 1,
      status: "failed",
      cause: "child_failed",
      candidateCount: 0,
      reason: "broken",
      consecutiveFailures: 3,
    })
  })

  test("#given a dropped deadline outcome #when reported #then no user notice is appended", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "dropped", cause: "deadline" }, collected)

    expect(entries).toEqual([{
      customType: "omo-kibitzer:gate",
      data: { version: 1, status: "dropped", cause: "deadline", candidateCount: 0 },
    }])
    expect(notices(entries)).toHaveLength(0)
  })

  test("#given a dropped outcome that names the judged model #when reported #then no user notice is appended", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createKibitzerGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "dropped", cause: "compaction", model: "omo-mock/healthy-fallback", runId: "run-1" }, collected)

    expect(entries).toEqual([{
      customType: "omo-kibitzer:gate",
      data: { version: 1, status: "dropped", cause: "compaction", model: "omo-mock/healthy-fallback", candidateCount: 0, runId: "run-1" },
    }])
    expect(notices(entries)).toHaveLength(0)
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
