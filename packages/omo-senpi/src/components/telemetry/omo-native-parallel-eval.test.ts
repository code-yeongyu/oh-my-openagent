import { describe, expect, test } from "bun:test"

import {
  emitFakeExtensionEvent,
  enableFakeExtensionEvents,
  fakeExtensionEventHandlerCount,
  FakeExtensionAPI,
} from "../../../test-support/fake-extension-api"
import {
  createParallelTelemetryRegistry,
  registerOmoNativeParallelTelemetry,
} from "./omo-native-parallel"

function context(sessionId: string): Record<string, unknown> {
  return { sessionManager: { getSessionId: () => sessionId } }
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

async function startEval(pi: FakeExtensionAPI, sessionId: string, cellId: string): Promise<void> {
  await pi.dispatch(
    "tool_execution_start",
    { type: "tool_execution_start", toolCallId: cellId, toolName: "eval", args: {} },
    context(sessionId),
  )
}

async function endEval(pi: FakeExtensionAPI, sessionId: string, cellId: string): Promise<void> {
  await pi.dispatch(
    "tool_execution_end",
    { type: "tool_execution_end", toolCallId: cellId, toolName: "eval", result: {}, isError: false },
    context(sessionId),
  )
}

function fixture(events = true): {
  readonly pi: FakeExtensionAPI
  readonly registry: ReturnType<typeof createParallelTelemetryRegistry>
} {
  const pi = new FakeExtensionAPI()
  if (events) enableFakeExtensionEvents(pi)
  const registry = createParallelTelemetryRegistry()
  registerOmoNativeParallelTelemetry(pi, { registry })
  return { pi, registry }
}

describe("omo-native eval execution correlation", () => {
  test("#given an event-capable host #when telemetry registers #then exactly one eval event handler is installed", () => {
    const { pi } = fixture()

    expect(fakeExtensionEventHandlerCount(pi, "senpi.eval.execution")).toBe(1)
  })

  test("#given a correlated eval cell #when its event settles #then exact nested rollups belong to that session", async () => {
    // given
    const { pi, registry } = fixture()
    await startEval(pi, "session-a", "eval-1")
    // when
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-1"))
    // then
    expect(registry.snapshot("session-a")).toMatchObject({
      evalExecutionEventBusAvailable: true,
      evalExecution: {
        eventCount: 1,
        rejectedCount: 0,
        nestedToolCallCount: 2,
        nestedToolCallOkCount: 2,
      },
    })
  })

  test("#given a detached eval whose outer call ended #when it later settles #then correlation remains alive", async () => {
    // given
    const { pi, registry } = fixture()
    await startEval(pi, "session-a", "eval-detached")
    await endEval(pi, "session-a", "eval-detached")
    // when
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-detached", { detached: true }))
    // then
    expect(registry.snapshot("session-a")?.evalExecution).toMatchObject({
      eventCount: 1,
      detachedCount: 1,
    })
  })

  test("#given a cell that already settled #when the event is duplicated #then it is counted once", async () => {
    // given
    const { pi, registry } = fixture()
    await startEval(pi, "session-a", "eval-once")
    // when
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-once"))
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-once"))
    // then
    expect(registry.snapshot("session-a")?.evalExecution?.eventCount).toBe(1)
  })

  test("#given one cell id owned by two sessions #when it settles #then attribution fails closed", async () => {
    // given
    const { pi, registry } = fixture()
    await startEval(pi, "session-a", "eval-collision")
    await startEval(pi, "session-b", "eval-collision")
    // when
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-collision"))
    // then
    expect(registry.snapshot("session-a")?.evalExecution?.eventCount).toBe(0)
    expect(registry.snapshot("session-b")?.evalExecution?.eventCount).toBe(0)
  })

  test("#given a correlated malformed event #when consumed #then it increments rejected once and discards correlation", async () => {
    // given
    const { pi, registry } = fixture()
    await startEval(pi, "session-a", "eval-invalid")
    // when
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-invalid", { version: 2 }))
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-invalid"))
    // then
    expect(registry.snapshot("session-a")?.evalExecution).toMatchObject({
      eventCount: 0,
      rejectedCount: 1,
    })
  })

  test("#given an older host without pi.events #when eval runs #then wave telemetry remains available with zero eval rollup", async () => {
    // given
    const { pi, registry } = fixture(false)
    // when
    await startEval(pi, "session-a", "eval-old-host")
    await endEval(pi, "session-a", "eval-old-host")
    // then
    expect(registry.snapshot("session-a")).toMatchObject({
      evalExecutionEventBusAvailable: false,
      evalExecution: { eventCount: 0, rejectedCount: 0 },
    })
    expect(registry.snapshot("session-a")?.assembly.counters.pairedCalls).toBe(1)
  })

  test("#given pending eval correlation #when the session shuts down #then a late event cannot resurrect state", async () => {
    // given
    const { pi, registry } = fixture()
    await startEval(pi, "session-a", "eval-late")
    // when
    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, context("session-a"))
    emitFakeExtensionEvent(pi, "senpi.eval.execution", event("eval-late"))
    // then
    expect(registry.snapshot("session-a")).toBeUndefined()
    expect(registry.size()).toBe(0)
  })
})
