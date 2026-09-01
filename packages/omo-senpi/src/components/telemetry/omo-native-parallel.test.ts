/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  createParallelTelemetryRegistry,
  registerOmoNativeParallelTelemetry,
  type ParallelTelemetryRegistry,
} from "./omo-native-parallel"

type Clock = { readonly advanceTo: (atMs: number) => void; readonly now: () => number }

function clockAt(startMs: number): Clock {
  let current = startMs
  return {
    advanceTo: (atMs: number) => {
      current = atMs
    },
    now: () => current,
  }
}

function context(sessionId: string): Record<string, unknown> {
  return { sessionManager: { getSessionId: () => sessionId } }
}

function fixture(startMs = 1_000): {
  readonly clock: Clock
  readonly pi: FakeExtensionAPI
  readonly registry: ParallelTelemetryRegistry
} {
  const clock = clockAt(startMs)
  const pi = new FakeExtensionAPI()
  const registry = createParallelTelemetryRegistry()
  registerOmoNativeParallelTelemetry(pi, { now: clock.now, registry })
  return { clock, pi, registry }
}

async function toolCall(
  pi: FakeExtensionAPI,
  clock: Clock,
  sessionId: string,
  call: { readonly toolCallId: string; readonly toolName: string; readonly startMs: number; readonly endMs: number },
): Promise<void> {
  clock.advanceTo(call.startMs)
  await pi.dispatch(
    "tool_execution_start",
    { type: "tool_execution_start", toolCallId: call.toolCallId, toolName: call.toolName, args: { secret: "do-not-store" } },
    context(sessionId),
  )
  clock.advanceTo(call.endMs)
  await pi.dispatch(
    "tool_execution_end",
    { type: "tool_execution_end", toolCallId: call.toolCallId, toolName: call.toolName, result: "do-not-store", isError: false },
    context(sessionId),
  )
}

describe("omo-native parallel telemetry", () => {
  describe("#given overlapping tool execution start and end pairs on one session", () => {
    describe("#when the session snapshot is assembled", () => {
      test("#then the observations form a single concurrency wave with the injected span", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        await toolCall(pi, clock, "session-a", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        await toolCall(pi, clock, "session-a", { toolCallId: "b", toolName: "read", startMs: 1_100, endMs: 1_600 })
        await toolCall(pi, clock, "session-a", { toolCallId: "c", toolName: "grep", startMs: 1_200, endMs: 1_400 })
        const snapshot = registry.snapshot("session-a")
        // then
        expect(snapshot?.assembly.waves.length).toBe(1)
        expect(snapshot?.assembly.waves[0]?.spanMs).toBe(600)
        expect(snapshot?.assembly.waves[0]?.calls.map((call) => call.toolName)).toEqual(["bash", "read", "grep"])
        expect(snapshot?.assembly.counters.pairedCalls).toBe(3)
      })

      test("#then only the tool call id and name are retained", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        await toolCall(pi, clock, "session-a", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        // then
        const call = registry.snapshot("session-a")?.assembly.waves[0]?.calls[0]
        expect(call).toEqual({ toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        expect(JSON.stringify(registry.snapshot("session-a"))).not.toContain("do-not-store")
      })
    })
  })

  describe("#given sequential tool executions", () => {
    describe("#when the session snapshot is assembled once", () => {
      test("#then every call forms its own wave", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        await toolCall(pi, clock, "session-a", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_100 })
        await toolCall(pi, clock, "session-a", { toolCallId: "b", toolName: "bash", startMs: 1_200, endMs: 1_300 })
        // then
        expect(registry.snapshot("session-a")?.assembly.waves.map((wave) => wave.calls.length)).toEqual([1, 1])
      })
    })
  })

  describe("#given a turn that starts with its own timestamp and ends without one", () => {
    describe("#when the turn end arrives at a stamped clock reading", () => {
      test("#then the measured turn duration accumulates across turns", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 2_000 }, context("session-a"))
        clock.advanceTo(2_750)
        await pi.dispatch("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, context("session-a"))
        await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 3_000 }, context("session-a"))
        clock.advanceTo(3_250)
        await pi.dispatch("turn_end", { type: "turn_end", turnIndex: 1, message: {}, toolResults: [] }, context("session-a"))
        // then
        expect(registry.snapshot("session-a")?.measuredTurnDurationMsTotal).toBe(1_000)
      })

      test("#then a turn end without a preceding start contributes nothing", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        clock.advanceTo(9_999)
        await pi.dispatch("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, context("session-a"))
        // then
        expect(registry.snapshot("session-a")?.measuredTurnDurationMsTotal ?? 0).toBe(0)
      })

      test("#then a turn end stamped before the turn start is not counted as negative time", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 5_000 }, context("session-a"))
        clock.advanceTo(4_000)
        await pi.dispatch("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, context("session-a"))
        // then
        expect(registry.snapshot("session-a")?.measuredTurnDurationMsTotal).toBe(0)
      })
    })
  })

  describe("#given an injected clock instead of the real one", () => {
    describe("#when tool executions are observed", () => {
      test("#then every recorded timestamp comes from the injected clock", async () => {
        // given
        const { clock, pi, registry } = fixture()
        const before = Date.now()
        // when
        await toolCall(pi, clock, "session-a", { toolCallId: "a", toolName: "bash", startMs: 42, endMs: 84 })
        // then
        const call = registry.snapshot("session-a")?.assembly.waves[0]?.calls[0]
        expect(call?.startMs).toBe(42)
        expect(call?.endMs).toBe(84)
        expect(before).toBeGreaterThan(1_000_000)
      })
    })
  })

  describe("#given two independent sessions dispatching interleaved observations", () => {
    describe("#when each session snapshot is assembled", () => {
      test("#then neither session sees the other session's calls", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        clock.advanceTo(1_000)
        await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: {} }, context("session-a"))
        clock.advanceTo(1_050)
        await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "b", toolName: "read", args: {} }, context("session-b"))
        clock.advanceTo(1_200)
        await pi.dispatch("tool_execution_end", { type: "tool_execution_end", toolCallId: "a", toolName: "bash", result: 1, isError: false }, context("session-a"))
        clock.advanceTo(1_300)
        await pi.dispatch("tool_execution_end", { type: "tool_execution_end", toolCallId: "b", toolName: "read", result: 1, isError: false }, context("session-b"))
        // then
        expect(registry.snapshot("session-a")?.assembly.waves[0]?.calls.map((call) => call.toolCallId)).toEqual(["a"])
        expect(registry.snapshot("session-b")?.assembly.waves[0]?.calls.map((call) => call.toolCallId)).toEqual(["b"])
      })
    })
  })

  describe("#given a session that has recorded observations", () => {
    describe("#when session_shutdown is dispatched", () => {
      test("#then the session state is dropped and nothing leaks", async () => {
        // given
        const { clock, pi, registry } = fixture()
        await toolCall(pi, clock, "session-a", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_100 })
        await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1_000 }, context("session-a"))
        expect(registry.size()).toBe(1)
        // when
        await pi.dispatch("session_shutdown", { type: "session_shutdown" }, context("session-a"))
        // then
        expect(registry.size()).toBe(0)
        expect(registry.snapshot("session-a")).toBeUndefined()
      })

      test("#then only the shutting-down session is dropped", async () => {
        // given
        const { clock, pi, registry } = fixture()
        await toolCall(pi, clock, "session-a", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_100 })
        await toolCall(pi, clock, "session-b", { toolCallId: "b", toolName: "bash", startMs: 1_000, endMs: 1_100 })
        // when
        await pi.dispatch("session_shutdown", { type: "session_shutdown" }, context("session-a"))
        // then
        expect(registry.size()).toBe(1)
        expect(registry.snapshot("session-b")?.assembly.counters.pairedCalls).toBe(1)
      })

      test("#then a shutdown mid sequence and a repeated shutdown are both safe", async () => {
        // given
        const { clock, pi, registry } = fixture()
        clock.advanceTo(1_000)
        await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: {} }, context("session-a"))
        // when
        await pi.dispatch("session_shutdown", { type: "session_shutdown" }, context("session-a"))
        clock.advanceTo(1_100)
        await pi.dispatch("tool_execution_end", { type: "tool_execution_end", toolCallId: "a", toolName: "bash", result: 1, isError: false }, context("session-a"))
        await pi.dispatch("session_shutdown", { type: "session_shutdown" }, context("session-a"))
        // then
        expect(registry.size()).toBe(0)
        expect(registry.snapshot("session-a")).toBeUndefined()
      })

      test("#then a late end or turn end does not resurrect the cleared session", async () => {
        // given
        const { clock, pi, registry } = fixture()
        await toolCall(pi, clock, "session-a", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_100 })
        await pi.dispatch("session_shutdown", { type: "session_shutdown" }, context("session-a"))
        // when
        clock.advanceTo(1_200)
        await pi.dispatch("tool_execution_end", { type: "tool_execution_end", toolCallId: "a", toolName: "bash", result: 1, isError: false }, context("session-a"))
        await pi.dispatch("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, context("session-a"))
        // then
        expect(registry.size()).toBe(0)
      })
    })
  })

  describe("#given malformed or unknown event payloads", () => {
    describe("#when they are dispatched to the subscribed handlers", () => {
      test("#then no handler throws and no observation is recorded", async () => {
        // given
        const { clock, pi, registry } = fixture()
        clock.advanceTo(1_000)
        const malformed: readonly unknown[] = [
          null,
          undefined,
          "tool_execution_start",
          42,
          [],
          { type: "tool_execution_start" },
          { type: "tool_execution_start", toolCallId: "", toolName: "bash" },
          { type: "tool_execution_start", toolCallId: "x" },
          { type: "tool_execution_start", toolCallId: 7, toolName: "bash" },
          { type: "message_start", toolCallId: "x", toolName: "bash" },
          { type: "tool_execution_end", toolCallId: "unknown", toolName: "bash" },
          { type: "turn_start" },
          { type: "turn_start", timestamp: "soon" },
        ]
        // when
        for (const payload of malformed) {
          await pi.dispatch("tool_execution_start", payload, context("session-a"))
          await pi.dispatch("tool_execution_end", payload, context("session-a"))
          await pi.dispatch("turn_start", payload, context("session-a"))
          await pi.dispatch("turn_end", payload, context("session-a"))
        }
        // then
        expect(registry.snapshot("session-a")?.assembly.waves ?? []).toEqual([])
        expect(registry.snapshot("session-a")?.measuredTurnDurationMsTotal ?? 0).toBe(0)
      })

      test("#then events without a resolvable session are ignored", async () => {
        // given
        const { clock, pi, registry } = fixture()
        clock.advanceTo(1_000)
        // when
        await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: {} }, {})
        await pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1_000 }, undefined)
        // then
        expect(registry.size()).toBe(0)
      })
    })
  })

  describe("#given a start whose end never arrives", () => {
    describe("#when the session snapshot is assembled", () => {
      test("#then the call is counted as incomplete rather than paired", async () => {
        // given
        const { clock, pi, registry } = fixture()
        // when
        clock.advanceTo(1_000)
        await pi.dispatch("tool_execution_start", { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: {} }, context("session-a"))
        // then
        const counters = registry.snapshot("session-a")?.assembly.counters
        expect(counters?.incomplete).toBe(1)
        expect(counters?.pairedCalls).toBe(0)
      })
    })
  })
})
