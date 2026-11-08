import { describe, expect, it } from "bun:test"
import type { ReflectionSnapshot, ReflectionTranscriptState } from "../journal"
import {
  completeTransition,
  evaluateTransitions,
  reserveTransition,
  type MachineState,
  type ReflectionRequest,
} from "./machine"

const REFLECTION_PENDING_MAX_CONVERSATIONS = 32
const REFLECTION_PENDING_MAX_BYTES = 4 * 1024 * 1024

function pendingRequest(conversationId: string, bytes = 1): ReflectionRequest {
  return {
    trigger: "manual", conversationIds: [conversationId],
    snapshots: [{ conversationId, snapshot: bulkySnapshot(bytes) }],
  }
}

/** A snapshot whose serialized entries weigh approximately `bytes`. */
function bulkySnapshot(bytes: number): ReflectionSnapshot {
  return {
    start_message_id: "start",
    end_message_id: "end",
    start_line: 0,
    end_snapshot_line: 1,
    entries: [{
      kind: "assistant",
      text: "x".repeat(Math.max(1, bytes)),
      captured_at: "2026-08-10T00:00:00.000Z",
      source_line_id: "line",
      source_message_id: "message",
    }],
  }
}

function journal(steps = 0, pendingCompaction = false) {
  const state: ReflectionTranscriptState = {
    schema_version: "v3_assistant_steps",
    total_completed_steps: steps,
    reflected_completed_steps: 0,
    steps_since_last_successful_reflection: steps,
    pending_compaction: pendingCompaction,
  }
  const snapshot: ReflectionSnapshot = {
    start_message_id: "start",
    end_message_id: `end-${steps}`,
    start_line: 0,
    end_snapshot_line: steps,
    entries: [],
  }
  return { conversationId: "conversation-a", state, snapshot }
}

function machine(steps = 0, stepCount: number | undefined = 5): MachineState {
  return {
    journal: journal(steps),
    reservation: {},
    config: { stepCount, onCompaction: true },
  }
}

function request(
  trigger: ReflectionRequest["trigger"],
  conversations = ["conversation-a"],
  origin?: "manual" | "idle" | "shutdown" | "pressure",
): ReflectionRequest {
  return {
    trigger,
    ...(trigger === "dream" ? { origin: origin ?? "manual" } : {}),
    conversationIds: conversations,
    snapshots: [{ conversationId: "conversation-a", snapshot: journal(6).snapshot }],
  }
}

describe("reflection trigger machine", () => {
  it("#given a successful settle at the configured step threshold #when evaluated #then it requests a step-count reservation", () => {
    const result = evaluateTransitions(machine(5), { kind: "settled", success: true })
    expect(result.action).toMatchObject({ kind: "reserve", request: { trigger: "step-count" } })
  })

  it("#given zero or undefined thresholds #when a successful run settles #then step count never launches", () => {
    expect(evaluateTransitions(machine(99, 0), { kind: "settled", success: true }).action).toEqual({ kind: "none" })
    const noThreshold = { ...machine(99), config: { onCompaction: true } }
    expect(evaluateTransitions(noThreshold, { kind: "settled", success: true }).action).toEqual({ kind: "none" })
  })

  it("#given a backlog at or above the snapshot byte budget #when a successful run settles below the step threshold #then a step-count reservation is requested", () => {
    // given
    const base = machine(1)
    const overflowing: MachineState = {
      ...base,
      journal: { ...base.journal, state: { ...base.journal.state, unreflected_bytes: 200_000 } },
      config: { ...base.config, snapshotMaxBytes: 131_072 },
    }
    const withinBudget: MachineState = {
      ...overflowing,
      journal: { ...base.journal, state: { ...base.journal.state, unreflected_bytes: 130_000 } },
    }

    // when / then
    expect(evaluateTransitions(overflowing, { kind: "settled", success: true }).action).toMatchObject({
      kind: "reserve",
      request: { trigger: "step-count" },
    })
    expect(evaluateTransitions(withinBudget, { kind: "settled", success: true }).action).toEqual({ kind: "none" })
  })

  it("#given a step-count run is already reserved #when the backlog overflows the budget #then no duplicate reservation is requested", () => {
    // given
    const base = machine(1)
    const overflowing: MachineState = {
      ...base,
      journal: { ...base.journal, state: { ...base.journal.state, unreflected_bytes: 200_000 } },
      reservation: reserveTransition({}, request("step-count"), "active").state,
    }

    // when / then
    expect(evaluateTransitions(overflowing, { kind: "settled", success: true }).action).toEqual({ kind: "none" })
  })

  it("#given an aborted or failed run #when it settles #then no automatic trigger launches", () => {
    expect(evaluateTransitions(machine(99), { kind: "settled", success: false }).action).toEqual({ kind: "none" })
  })

  it("#given compaction was accepted #when several successful boundaries settle #then its reservation is emitted exactly once", () => {
    const accepted = evaluateTransitions(machine(0), { kind: "compaction_accepted" }).state
    const first = evaluateTransitions(accepted, { kind: "settled", success: true })
    expect(first.action).toMatchObject({ kind: "reserve", request: { trigger: "compaction" } })
    const reserved = reserveTransition(first.state.reservation, request("compaction"), "run-active")
    const second = evaluateTransitions({ ...first.state, reservation: reserved.state }, { kind: "settled", success: true })
    expect(second.action).toEqual({ kind: "none" })
  })

  it("#given an active threshold run #when compaction and manual requests arrive #then one pending slot unions conversations and preserves manual priority", () => {
    const active = reserveTransition({}, request("step-count"), "active")
    const compacted = reserveTransition(active.state, request("compaction", ["conversation-b"]), "pending-1")
    const manual = reserveTransition(
      compacted.state,
      { ...request("manual", ["conversation-c"]), focus: "facts", recentN: 20 },
      "pending-2",
    )
    expect(manual.result).toBe("pending")
    expect(manual.state.pending?.runId).toBe("pending-1")
    expect(manual.state.pending?.request).toMatchObject({
      trigger: "manual",
      conversationIds: ["conversation-b", "conversation-c"],
      focus: "facts",
      recentN: 20,
    })
  })

  it("#given reflection and dream requests #when they compete for one pending slot #then the specified priority order and newest tie winner are preserved", () => {
    const priorities = [
      request("step-count"),
      request("dream", undefined, "idle"),
      request("compaction"),
      request("dream", undefined, "shutdown"),
      request("manual"),
      request("dream", undefined, "manual"),
    ]
    let state = reserveTransition({}, request("step-count"), "active").state
    priorities.forEach((candidate, index) => {
      state = reserveTransition(state, candidate, `pending-${index}`).state
    })
    expect(state.active?.request.trigger).toBe("step-count")
    expect(state.pending?.request).toMatchObject({ trigger: "dream", origin: "manual" })
  })

  it("#given two dream requests during an active reflection #when they merge #then one pending dream unions snapshots and the newest equal-priority request wins", () => {
    const active = reserveTransition({}, request("manual"), "active")
    const idle = reserveTransition(active.state, request("dream", ["conversation-a"], "idle"), "dream-idle")
    const newerIdle = reserveTransition(
      idle.state,
      {
        ...request("dream", ["conversation-b"], "idle"),
        focus: "newest dream",
        snapshots: [{ conversationId: "conversation-b", snapshot: journal(7).snapshot }],
      },
      "dream-newer",
    )
    expect(newerIdle.state.pending?.runId).toBe("dream-idle")
    expect(newerIdle.state.pending?.request).toMatchObject({
      trigger: "dream",
      origin: "idle",
      focus: "newest dream",
      conversationIds: ["conversation-a", "conversation-b"],
    })
    expect(newerIdle.state.pending?.request.snapshots.map((item) => item.conversationId)).toEqual([
      "conversation-a",
      "conversation-b",
    ])
  })

  it("#given more pending conversations than the merge allows #when they union #then the newest survive and the oldest are evicted", () => {
    // given: one reflection stays active while a conversation per reservation keeps queueing.
    const overflow = REFLECTION_PENDING_MAX_CONVERSATIONS + 5
    let state = reserveTransition({}, request("step-count", ["active-conversation"]), "active").state
    for (let index = 0; index < overflow; index += 1) {
      state = reserveTransition(state, pendingRequest(`conversation-${index}`), `pending-${index}`).state
    }

    // then: the union is capped, and eviction drops the oldest first.
    const merged = state.pending?.request.snapshots.map((item) => item.conversationId) ?? []
    expect(merged).toHaveLength(REFLECTION_PENDING_MAX_CONVERSATIONS)
    expect(merged).toEqual(
      Array.from({ length: REFLECTION_PENDING_MAX_CONVERSATIONS }, (_, index) =>
        `conversation-${overflow - REFLECTION_PENDING_MAX_CONVERSATIONS + index}`),
    )
  })

  it("#given pending snapshots past the aggregate byte budget #when they union #then the oldest are evicted until the merge fits", () => {
    // given: each snapshot carries roughly a tenth of the aggregate budget, so a bounded number fit.
    const perSnapshotBytes = Math.floor(REFLECTION_PENDING_MAX_BYTES / 10)
    const heavy = (conversationId: string): ReflectionRequest => ({
      trigger: "step-count",
      conversationIds: [conversationId],
      snapshots: [{ conversationId, snapshot: bulkySnapshot(perSnapshotBytes) }],
    })

    let state = reserveTransition({}, heavy("active-conversation"), "active").state
    for (let index = 0; index < 30; index += 1) {
      state = reserveTransition(state, heavy(`conversation-${index}`), `pending-${index}`).state
    }

    // then
    const snapshots = state.pending?.request.snapshots ?? []
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.length).toBeLessThan(30)
    expect(Buffer.byteLength(`${JSON.stringify(state.pending, null, 2)}\n`, "utf8")).toBeLessThanOrEqual(REFLECTION_PENDING_MAX_BYTES)
    expect(state.pending?.request.conversationIds).toEqual(snapshots.map((item) => item.conversationId))
    // eviction is oldest-first, so the newest request always survives.
    expect(snapshots.at(-1)?.conversationId).toBe("conversation-29")
  })

  it("#given a single snapshot larger than the aggregate budget #when it first becomes pending #then it is evicted without changing active work", () => {
    const huge: ReflectionRequest = {
      trigger: "manual",
      conversationIds: ["conversation-huge"],
      snapshots: [{ conversationId: "conversation-huge", snapshot: bulkySnapshot(REFLECTION_PENDING_MAX_BYTES * 2) }],
    }
    const active = reserveTransition({}, request("step-count"), "active")
    const state = reserveTransition(active.state, huge, "pending").state

    expect(state.pending?.request.snapshots).toEqual([])
    expect(state.pending?.request.conversationIds).toEqual([])
    expect(state.active).toBe(active.state.active)
  })

  it("#given UTF-8 snapshots and JSON escaping #when the pending byte cap evicts #then the serialized payload fits and keeps the newest suffix", () => {
    const snapshot = bulkySnapshot(1)
    const unicode: ReflectionSnapshot = { ...snapshot, entries: [{
      kind: "assistant", text: '\u00e9\\n\\"'.repeat(200_000), captured_at: "2026-08-10T00:00:00.000Z",
      source_line_id: "line", source_message_id: "message",
    }] }
    let state = reserveTransition({}, pendingRequest("active"), "active").state
    for (let index = 0; index < 4; index += 1) {
      const conversationId = `conversation-${index}`
      state = reserveTransition(state, {
        trigger: "manual", conversationIds: [conversationId], snapshots: [{ conversationId, snapshot: unicode }],
      }, `pending-${index}`).state
    }
    expect(state.pending?.request.conversationIds).toEqual(["conversation-2", "conversation-3"])
    expect(Buffer.byteLength(`${JSON.stringify(state.pending, null, 2)}\n`, "utf8")).toBeLessThanOrEqual(REFLECTION_PENDING_MAX_BYTES)
  })

  it("#given an initial pending request with only conversation ids #when it exceeds the count cap #then ids are bounded too", () => {
    const active = reserveTransition({}, pendingRequest("active"), "active").state
    const ids = Array.from({ length: 40 }, (_, index) => `conversation-${index}`)
    const queued = reserveTransition(active, { trigger: "manual", conversationIds: ids, snapshots: [] }, "pending")
    expect(queued.state.pending?.request.conversationIds).toEqual(ids.slice(8))
  })

  it("#given a recaptured oldest pending conversation #when the count cap overflows #then first-seen order determines eviction", () => {
    let state = reserveTransition({}, pendingRequest("active"), "active").state
    for (let index = 0; index < 32; index += 1) {
      state = reserveTransition(state, pendingRequest(`conversation-${index}`), `pending-${index}`).state
    }
    state = reserveTransition(state, pendingRequest("conversation-0", 20), "ignored").state
    state = reserveTransition(state, pendingRequest("conversation-32"), "ignored").state
    expect(state.pending?.runId).toBe("pending-0")
    expect(state.pending?.request.conversationIds).toEqual(Array.from({ length: 32 }, (_, index) => `conversation-${index + 1}`))
  })

  it("#given legacy oversized pending state #when the dead active run completes #then promotion applies the same bounds", () => {
    const requests = Array.from({ length: 40 }, (_, index) => pendingRequest(`conversation-${index}`))
    const pending = { runId: "legacy-pending", request: {
      trigger: "manual" as const,
      conversationIds: requests.flatMap((item) => item.conversationIds),
      snapshots: requests.flatMap((item) => item.snapshots),
    } }
    const result = completeTransition({
      active: { runId: "active", request: pendingRequest("active") }, pending,
    }, "active", "failed", new Map(), {})

    expect(result.launch?.request.conversationIds).toEqual(pending.request.conversationIds.slice(8))
    expect(result.launch?.request.snapshots.map((item) => item.conversationId)).toEqual(pending.request.conversationIds.slice(8))
    expect(result.finalize).toEqual([])
  })

  it("#given interleaved reflection and dream requests #when every bounded event sequence is applied #then at most one active and one pending run exist", () => {
    const candidates = [
      request("step-count"),
      request("compaction"),
      request("manual"),
      request("dream", undefined, "idle"),
      request("dream", undefined, "shutdown"),
      request("dream", undefined, "manual"),
    ]
    for (const first of candidates) {
      for (const second of candidates) {
        for (const third of candidates) {
          let state = reserveTransition({}, first, "run-1").state
          state = reserveTransition(state, second, "run-2").state
          state = reserveTransition(state, third, "run-3").state
          expect([state.active, state.pending].filter(Boolean).length).toBeLessThanOrEqual(2)
          expect(state.active).toBeDefined()
          expect(state.pending?.runId).not.toBe(state.active?.runId)
        }
      }
    }
  })

  it("#given every completion outcome #when the active run completes #then only merged and no_changes advance its captured cursor", () => {
    const outcomes = ["merged", "no_changes", "parent_dirty", "merge_conflict", "dirty_uncommitted", "failed", "timed_out"] as const
    for (const outcome of outcomes) {
      const active = reserveTransition({}, request("step-count"), "run")
      const result = completeTransition(active.state, "run", outcome, new Map([["conversation-a", journal(6)]]), { stepCount: 5, onCompaction: true })
      expect(result.finalize).toHaveLength(outcome === "merged" || outcome === "no_changes" ? 1 : 0)
      expect(result.state.active).toBeUndefined()
    }
  })

  it("#given a failed active run and a queued request #when completed #then the cursor stays unmoved and pending is promoted", () => {
    const active = reserveTransition({}, request("manual"), "active")
    const queued = reserveTransition(active.state, request("step-count"), "pending")
    const result = completeTransition(queued.state, "active", "failed", new Map([["conversation-a", journal(6)]]), { stepCount: 5 })
    expect(result.finalize).toEqual([])
    expect(result.launch?.runId).toBe("pending")
  })

  it("#given pending automatic work became stale #when dequeued #then it is dropped, while manual work survives", () => {
    const active = reserveTransition({}, request("manual"), "active")
    const stale = reserveTransition(active.state, request("step-count"), "stale")
    const staleResult = completeTransition(stale.state, "active", "failed", new Map([["conversation-a", journal(1)]]), { stepCount: 5 })
    expect(staleResult.launch).toBeUndefined()

    const automatic = reserveTransition({}, request("step-count"), "active")
    const manual = reserveTransition(automatic.state, request("manual"), "manual")
    const manualResult = completeTransition(manual.state, "active", "failed", new Map([["conversation-a", journal(0)]]), { stepCount: 5 })
    expect(manualResult.launch?.request.trigger).toBe("manual")
  })
})
