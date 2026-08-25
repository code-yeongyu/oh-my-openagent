/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerOmoNativeParallelSummary } from "./omo-native-parallel-summary"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"
import { MAX_TRACKED_CALLS } from "./wave-assembler"

type Captured = { readonly name: string; readonly properties: EventTelemetryProperties }

type Clock = { readonly advanceTo: (atMs: number) => void; readonly now: () => number }

type Fixture = {
  readonly captured: readonly Captured[]
  readonly clock: Clock
  readonly pi: FakeExtensionAPI
}

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

function fixture(): Fixture {
  const captured: Captured[] = []
  const clock = clockAt(1_000)
  const pi = new FakeExtensionAPI()
  registerOmoNativeParallelSummary(pi, {
    captureEvent: (name, properties) => captured.push({ name, properties }),
    hashSessionId: (raw) => `hashed:${raw}`,
    now: clock.now,
  })
  return { captured, clock, pi }
}

async function toolCall(
  fx: Fixture,
  sessionId: string,
  call: { readonly toolCallId: string; readonly toolName: string; readonly startMs: number; readonly endMs: number },
): Promise<void> {
  fx.clock.advanceTo(call.startMs)
  await fx.pi.dispatch(
    "tool_execution_start",
    { type: "tool_execution_start", toolCallId: call.toolCallId, toolName: call.toolName, args: {} },
    context(sessionId),
  )
  fx.clock.advanceTo(call.endMs)
  await fx.pi.dispatch(
    "tool_execution_end",
    { type: "tool_execution_end", toolCallId: call.toolCallId, toolName: call.toolName, result: 1, isError: false },
    context(sessionId),
  )
}

async function startOnly(fx: Fixture, sessionId: string, toolCallId: string, atMs: number): Promise<void> {
  fx.clock.advanceTo(atMs)
  await fx.pi.dispatch(
    "tool_execution_start",
    { type: "tool_execution_start", toolCallId, toolName: "bash", args: {} },
    context(sessionId),
  )
}

async function endOnly(fx: Fixture, sessionId: string, toolCallId: string, atMs: number): Promise<void> {
  fx.clock.advanceTo(atMs)
  await fx.pi.dispatch(
    "tool_execution_end",
    { type: "tool_execution_end", toolCallId, toolName: "bash", result: 1, isError: false },
    context(sessionId),
  )
}

async function shutdown(fx: Fixture, sessionId: string): Promise<void> {
  await fx.pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context(sessionId))
}

describe("omo-native parallelism summary emission", () => {
  describe("#given one session with overlapping non-eval tool calls", () => {
    describe("#when the session shuts down", () => {
      test("#then exactly one parallelism_summary carries the session's wave metrics", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        await toolCall(fx, "s1", { toolCallId: "b", toolName: "read", startMs: 1_100, endMs: 1_400 })
        // when
        await shutdown(fx, "s1")
        // then
        expect(fx.captured).toHaveLength(1)
        expect(fx.captured[0]?.name).toBe("parallelism_summary")
        expect(fx.captured[0]?.properties).toMatchObject({
          $session_id: "hashed:s1",
          non_eval_waves_total: 1,
          non_eval_waves_multi: 1,
          non_eval_joined_calls: 2,
          non_eval_saved_round_trips: 1,
          modeled_wallclock_saved_ms: 300,
          schema_kind: "parallelism_v3",
        })
      })

      test("#then every emitted key is inside the parallelism_summary allowlist", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        // when
        await shutdown(fx, "s1")
        // then
        expect(Object.keys(fx.captured[0]?.properties ?? {}).sort()).toEqual(
          [...OMO_NATIVE_PROPERTY_ALLOWLISTS.parallelism_summary].sort(),
        )
      })

      test("#then dropped_calls, incomplete_calls and clock_anomalies are all carried through", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "ok", toolName: "bash", startMs: 1_000, endMs: 1_100 })
        await startOnly(fx, "s1", "never-ends", 1_200)
        await startOnly(fx, "s1", "reversed", 1_300)
        await endOnly(fx, "s1", "reversed", 1_250)
        // when
        await shutdown(fx, "s1")
        // then
        expect(fx.captured[0]?.properties).toMatchObject({
          dropped_calls: 0,
          incomplete_calls: 1,
          clock_anomalies: 1,
        })
      })
    })
  })

  describe("#given eval-only and mixed waves alongside non-eval waves", () => {
    describe("#when the summary is built", () => {
      test("#then non_eval metrics exclude both the eval-only and the mixed wave", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "n1", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        await toolCall(fx, "s1", { toolCallId: "n2", toolName: "read", startMs: 1_100, endMs: 1_400 })
        await toolCall(fx, "s1", { toolCallId: "e1", toolName: "eval", startMs: 2_000, endMs: 2_700 })
        await toolCall(fx, "s1", { toolCallId: "m1", toolName: "eval", startMs: 3_000, endMs: 3_900 })
        await toolCall(fx, "s1", { toolCallId: "m2", toolName: "bash", startMs: 3_100, endMs: 3_400 })
        // when
        await shutdown(fx, "s1")
        // then
        expect(fx.captured[0]?.properties).toMatchObject({
          non_eval_waves_total: 1,
          non_eval_joined_calls: 2,
          non_eval_saved_round_trips: 1,
          modeled_wallclock_saved_ms: 300,
          eval_only_waves: 1,
          eval_only_duration_ms: 700,
          mixed_waves: 1,
        })
      })

      test("#then the mixed wave's savings never leak into modeled_wallclock_saved_ms", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "m1", toolName: "eval", startMs: 3_000, endMs: 3_900 })
        await toolCall(fx, "s1", { toolCallId: "m2", toolName: "bash", startMs: 3_100, endMs: 3_400 })
        // when
        await shutdown(fx, "s1")
        // then
        expect(fx.captured[0]?.properties).toMatchObject({
          mixed_waves: 1,
          non_eval_waves_total: 0,
          modeled_wallclock_saved_ms: 0,
          upper_bound_saved_ms: 0,
          non_eval_saved_round_trips: 0,
        })
      })
    })
  })

  describe("#given the wave size histogram", () => {
    describe("#when waves of several sizes are summarized", () => {
      test("#then it is positionally encoded, unlabelled, and short enough to survive truncation", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_100 })
        await toolCall(fx, "s1", { toolCallId: "b", toolName: "bash", startMs: 2_000, endMs: 2_500 })
        await toolCall(fx, "s1", { toolCallId: "c", toolName: "read", startMs: 2_100, endMs: 2_400 })
        // when
        await shutdown(fx, "s1")
        // then
        const histogram = fx.captured[0]?.properties.non_eval_wave_size_histogram
        expect(histogram).toBe("1:1:0:0:0:0:0:0")
        expect(String(histogram)).not.toContain("=")
        expect(String(histogram).length).toBeLessThan(64)
      })
    })
  })

  describe("#given more tool calls than MAX_TRACKED_CALLS", () => {
    describe("#when the capped session is summarized", () => {
      test("#then dropped_calls exposes the refused calls and the four-sink accounting closes", async () => {
        // given
        const fx = fixture()
        const observed = MAX_TRACKED_CALLS + 500
        for (let index = 0; index < observed; index += 1) await startOnly(fx, "s1", `c${index}`, 1_000 + index)
        for (let index = 0; index < observed; index += 1) await endOnly(fx, "s1", `c${index}`, 100_000 + index)
        // when
        await shutdown(fx, "s1")
        // then
        const properties = fx.captured[0]?.properties
        expect(properties).toMatchObject({
          dropped_calls: 500,
          incomplete_calls: 0,
          clock_anomalies: 0,
          non_eval_joined_calls: MAX_TRACKED_CALLS,
        })
        const paired = Number(properties?.non_eval_joined_calls)
        const sinks = paired + Number(properties?.incomplete_calls) + Number(properties?.dropped_calls) + Number(properties?.clock_anomalies)
        expect(sinks).toBe(observed)
        expect(String(properties?.non_eval_wave_size_histogram).length).toBeLessThan(64)
      })
    })
  })

  describe("#given a session with nothing worth reporting", () => {
    describe("#when it shuts down", () => {
      test("#then an idle session emits no event", async () => {
        // given
        const fx = fixture()
        // when
        await shutdown(fx, "s1")
        // then
        expect(fx.captured).toEqual([])
      })

      test("#then a session whose only calls are incomplete or anomalous emits no event", async () => {
        // given
        const fx = fixture()
        await startOnly(fx, "s1", "never-ends", 1_000)
        await startOnly(fx, "s1", "reversed", 1_100)
        await endOnly(fx, "s1", "reversed", 1_050)
        // when
        await shutdown(fx, "s1")
        // then
        expect(fx.captured).toEqual([])
      })

      test("#then a turn with no tool calls at all emits no event", async () => {
        // given
        const fx = fixture()
        await fx.pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1_000 }, context("s1"))
        fx.clock.advanceTo(1_900)
        await fx.pi.dispatch("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, context("s1"))
        // when
        await shutdown(fx, "s1")
        // then
        expect(fx.captured).toEqual([])
      })
    })
  })

  describe("#given repeated and interleaved session lifecycles", () => {
    describe("#when shutdown fires more than once or for two sessions", () => {
      test("#then a second shutdown for the same session emits nothing", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        // when
        await shutdown(fx, "s1")
        await shutdown(fx, "s1")
        // then
        expect(fx.captured).toHaveLength(1)
      })

      test("#then two sessions each emit their own payload and never mix", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        await toolCall(fx, "s2", { toolCallId: "b", toolName: "read", startMs: 1_000, endMs: 1_500 })
        await toolCall(fx, "s2", { toolCallId: "c", toolName: "grep", startMs: 1_100, endMs: 1_400 })
        // when
        await shutdown(fx, "s1")
        await shutdown(fx, "s2")
        // then
        expect(fx.captured.map(({ properties }) => properties.$session_id)).toEqual(["hashed:s1", "hashed:s2"])
        expect(fx.captured[0]?.properties.non_eval_joined_calls).toBe(1)
        expect(fx.captured[1]?.properties.non_eval_joined_calls).toBe(2)
      })

      test("#then a shutdown mid turn still emits the completed calls exactly once", async () => {
        // given
        const fx = fixture()
        await fx.pi.dispatch("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 1_000 }, context("s1"))
        await toolCall(fx, "s1", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        await toolCall(fx, "s1", { toolCallId: "b", toolName: "read", startMs: 1_100, endMs: 1_400 })
        await startOnly(fx, "s1", "c", 1_600)
        // when
        await shutdown(fx, "s1")
        await endOnly(fx, "s1", "c", 1_700)
        await shutdown(fx, "s1")
        // then
        expect(fx.captured).toHaveLength(1)
        expect(fx.captured[0]?.properties).toMatchObject({ non_eval_joined_calls: 2, incomplete_calls: 1 })
      })

      test("#then a shutdown without a resolvable session emits nothing and spares live sessions", async () => {
        // given
        const fx = fixture()
        await toolCall(fx, "s1", { toolCallId: "a", toolName: "bash", startMs: 1_000, endMs: 1_500 })
        // when
        await fx.pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, {})
        // then
        expect(fx.captured).toEqual([])
        await shutdown(fx, "s1")
        expect(fx.captured).toHaveLength(1)
      })
    })
  })
})
