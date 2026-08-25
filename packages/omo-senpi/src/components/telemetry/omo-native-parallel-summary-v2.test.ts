import { describe, expect, test } from "bun:test"

import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"
import {
  emitFakeExtensionEvent,
  enableFakeExtensionEvents,
  FakeExtensionAPI,
} from "../../../test-support/fake-extension-api"
import { registerOmoNativeParallelSummary } from "./omo-native-parallel-summary"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"

type Captured = { readonly name: string; readonly properties: EventTelemetryProperties }

function context(sessionId: string): Record<string, unknown> {
  return { sessionManager: { getSessionId: () => sessionId } }
}

function turnEnd(inputTokens = 10, cacheReadTokens = 4): Record<string, unknown> {
  return {
    type: "turn_end",
    turnIndex: 1,
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-5.6-sol",
      usage: {
        input: inputTokens,
        output: 1,
        cacheRead: cacheReadTokens,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: inputTokens + cacheReadTokens + 1,
        cost: { total: 0 },
      },
    },
    toolResults: [],
  }
}

function event(cellId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    detailLevel: "full",
    cellId,
    language: "js",
    ok: true,
    startedAt: 1_000,
    completedAt: 1_030,
    durationMs: 30,
    kernelDurationMs: 24,
    detached: false,
    toolCallCount: 2,
    pendingToolCallCount: 0,
    toolCalls: [],
    distinctToolsCalled: ["read", "bash"],
    toolAggregates: {
      read: { count: 1, totalDurationMs: 12, okCount: 1, errorCount: 0, pendingCount: 0 },
      bash: { count: 1, totalDurationMs: 18, okCount: 1, errorCount: 0, pendingCount: 0 },
    },
    toolAggregatesTruncated: false,
    ...overrides,
  }
}

function fixture(events = true): {
  readonly captured: Captured[]
  readonly pi: FakeExtensionAPI
  readonly clock: { advanceTo: (atMs: number) => void }
} {
  const captured: Captured[] = []
  let currentMs = 1_000
  const clock = { advanceTo: (atMs: number) => { currentMs = atMs } }
  const pi = new FakeExtensionAPI()
  if (events) enableFakeExtensionEvents(pi)
  registerOmoNativeParallelSummary(pi, {
    captureEvent: (name, properties) => captured.push({ name, properties }),
    hashSessionId: (raw) => `hashed:${raw}`,
    now: () => currentMs,
  })
  return { captured, pi, clock }
}

async function start(pi: FakeExtensionAPI, sessionId: string, toolCallId: string, toolName: string): Promise<void> {
  await pi.dispatch(
    "tool_execution_start",
    { type: "tool_execution_start", toolCallId, toolName, args: {} },
    context(sessionId),
  )
}

async function end(pi: FakeExtensionAPI, sessionId: string, toolCallId: string, toolName: string): Promise<void> {
  await pi.dispatch(
    "tool_execution_end",
    { type: "tool_execution_end", toolCallId, toolName, result: {}, isError: false },
    context(sessionId),
  )
}

async function shutdown(pi: FakeExtensionAPI, sessionId: string): Promise<void> {
  await pi.dispatch("session_shutdown", { type: "session_shutdown" }, context(sessionId))
}

describe("omo-native parallelism v3 summary", () => {
  test("#given one eval-only wrapper with two nested tools #when shutdown fires #then nested counts stay outside wave savings", async () => {
    // given
    const { captured, pi } = fixture()
    await start(pi, "s1", "eval-1", "eval")
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-1"))
    await end(pi, "s1", "eval-1", "eval")
    // when
    await shutdown(pi, "s1")
    // then
    expect(captured).toHaveLength(1)
    expect(captured[0]?.properties).toMatchObject({
      $session_id: "hashed:s1",
      schema_kind: "parallelism_v3",
      current_prefix_tokens: 0,
      non_eval_saved_prefix_tokens: 0,
      eval_saved_prefix_tokens: 0,
      eval_cells_with_nested_count: 1,
      eval_execution_event_bus_available: true,
      eval_execution_event_count: 1,
      eval_execution_event_rejected_count: 0,
      eval_execution_ok_count: 1,
      eval_execution_detached_count: 0,
      measured_eval_execution_duration_ms_sum: 30,
      eval_nested_tool_call_count: 2,
      eval_nested_tool_call_ok_count: 2,
      eval_nested_tool_call_error_count: 0,
      eval_nested_tool_call_pending_count: 0,
      measured_eval_nested_tool_duration_ms_sum: 30,
      eval_tool_aggregate_truncated_execution_count: 0,
      eval_outer_joined_calls: 1,
      mixed_non_eval_joined_calls: 0,
      eval_only_waves: 1,
      non_eval_waves_total: 0,
      non_eval_joined_calls: 0,
      non_eval_saved_round_trips: 0,
      modeled_wallclock_saved_ms: 0,
      upper_bound_saved_ms: 0,
    })
    expect(Object.keys(captured[0]?.properties ?? {}).sort()).toEqual(
      [...OMO_NATIVE_PROPERTY_ALLOWLISTS.parallelism_summary].sort(),
    )
  })

  test("#given overlapping eval and direct calls #when summarized #then mixed direct and outer eval counts are separate", async () => {
    // given
    const { captured, pi } = fixture()
    await start(pi, "s1", "eval-1", "eval")
    await start(pi, "s1", "bash-1", "bash")
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-1"))
    await end(pi, "s1", "bash-1", "bash")
    await end(pi, "s1", "eval-1", "eval")
    // when
    await shutdown(pi, "s1")
    // then
    expect(captured[0]?.properties).toMatchObject({
      mixed_waves: 1,
      eval_outer_joined_calls: 1,
      mixed_non_eval_joined_calls: 1,
      non_eval_waves_total: 0,
      non_eval_joined_calls: 0,
      modeled_wallclock_saved_ms: 0,
      non_eval_saved_round_trips: 0,
      eval_nested_tool_call_count: 2,
    })
  })

  test("#given an older host without events #when eval completes #then v2 emits explicit unavailable zero defaults", async () => {
    // given
    const { captured, pi } = fixture(false)
    await start(pi, "s1", "eval-old", "eval")
    await end(pi, "s1", "eval-old", "eval")
    // when
    await shutdown(pi, "s1")
    // then
    expect(captured[0]?.properties).toMatchObject({
      schema_kind: "parallelism_v3",
      current_prefix_tokens: 0,
      non_eval_saved_prefix_tokens: 0,
      eval_saved_prefix_tokens: 0,
      eval_cells_with_nested_count: 0,
      eval_execution_event_bus_available: false,
      eval_execution_event_count: 0,
      eval_execution_event_rejected_count: 0,
      eval_nested_tool_call_count: 0,
      eval_outer_joined_calls: 1,
    })
  })

  test("#given completed turns and two non-eval waves #when shutdown fires #then prefix savings accumulate for every wave", async () => {
    // given
    const { captured, pi, clock } = fixture()
    await pi.dispatch("turn_end", turnEnd(10, 4), context("s1"))
    clock.advanceTo(1_000)
    await start(pi, "s1", "bash-1", "bash")
    clock.advanceTo(1_100)
    await start(pi, "s1", "read-1", "read")
    clock.advanceTo(1_200)
    await end(pi, "s1", "bash-1", "bash")
    clock.advanceTo(1_300)
    await end(pi, "s1", "read-1", "read")
    clock.advanceTo(1_500)
    await start(pi, "s1", "grep-1", "grep")
    clock.advanceTo(1_600)
    await end(pi, "s1", "grep-1", "grep")
    // when
    await shutdown(pi, "s1")
    // then
    expect(captured[0]?.properties).toMatchObject({
      schema_kind: "parallelism_v3",
      current_prefix_tokens: 14,
      non_eval_saved_prefix_tokens: 14,
      eval_saved_prefix_tokens: 0,
      eval_cells_with_nested_count: 0,
    })
  })

  test("#given a completed turn and an eval cell with two nested tools #when shutdown fires #then cell savings are attributed once", async () => {
    // given
    const { captured, pi } = fixture()
    await pi.dispatch("turn_end", turnEnd(10, 4), context("s1"))
    await start(pi, "s1", "eval-1", "eval")
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-1"))
    await end(pi, "s1", "eval-1", "eval")
    // when
    await shutdown(pi, "s1")
    // then
    expect(captured[0]?.properties).toMatchObject({
      schema_kind: "parallelism_v3",
      current_prefix_tokens: 14,
      eval_saved_prefix_tokens: 14,
      eval_cells_with_nested_count: 1,
    })
  })

  test("#given no completed turn #when a parallel wave is summarized #then prefix savings remain zero", async () => {
    // given
    const { captured, pi } = fixture()
    await start(pi, "s1", "bash-1", "bash")
    await start(pi, "s1", "read-1", "read")
    await end(pi, "s1", "bash-1", "bash")
    await end(pi, "s1", "read-1", "read")
    // when
    await shutdown(pi, "s1")
    // then
    expect(captured[0]?.properties).toMatchObject({
      schema_kind: "parallelism_v3",
      current_prefix_tokens: 0,
      non_eval_saved_prefix_tokens: 0,
    })
  })

  test("#given a correlated invalid event #when shutdown fires #then rejection is visible without partial totals", async () => {
    // given
    const { captured, pi } = fixture()
    await start(pi, "s1", "eval-invalid", "eval")
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-invalid", { version: 2 }))
    await end(pi, "s1", "eval-invalid", "eval")
    // when
    await shutdown(pi, "s1")
    // then
    expect(captured[0]?.properties).toMatchObject({
      eval_execution_event_count: 0,
      eval_execution_event_rejected_count: 1,
      eval_nested_tool_call_count: 0,
    })
  })

  test("#given a valid eval event but an incomplete outer wrapper #when shutdown fires #then the event still justifies one summary", async () => {
    // given
    const { captured, pi } = fixture()
    await start(pi, "s1", "eval-incomplete", "eval")
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-incomplete"))
    // when
    await shutdown(pi, "s1")
    await shutdown(pi, "s1")
    // then
    expect(captured).toHaveLength(1)
    expect(captured[0]?.properties).toMatchObject({
      eval_execution_event_count: 1,
      incomplete_calls: 1,
      eval_outer_joined_calls: 0,
    })
  })
})
