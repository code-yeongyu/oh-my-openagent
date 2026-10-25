import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import type { AgentSessionEvent, RpcResponse } from "@code-yeongyu/senpi"
import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import type { RpcChildHandle } from "../types"
import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"
import { createChildExtensionEvents } from "../child-extension-events"
import { createManualSettlementScheduler, flushSettlement } from "./turn-settlement.test-support"
import type { TurnSettlementScheduler } from "./turn-settlement"

const PROVIDER_TIMEOUT = "Provider stream start timed out after 300000ms"

type OutcomeTrackedHandle = RpcChildHandle & {
  waitForOutcome(): Promise<RunnerOutcome>
  dispose(): Promise<void>
}

const IDLE_STATE = {
  sessionId: "s-1",
  isStreaming: false,
  steering: [],
  followUp: [],
  pendingMessageCount: 0,
}

/**
 * The handle's settle confirmation rides the SAME raw record stream the child emits: goal
 * continuation timer records reach it as `extension_event` frames (senpi#3208 publishes them
 * through `pi.rpc.emit`), never through the permission-shaped extension channel. This suite
 * proves that ingestion at the real seam (senpi#3262).
 */
function createHarness(
  settleConfirmMs: number,
  settlementScheduler?: TurnSettlementScheduler,
  getState?: () => Promise<RpcResponse>,
): {
  readonly handle: OutcomeTrackedHandle
  readonly emit: (record: unknown) => void
} {
  const child = Object.assign(new EventEmitter(), { pid: 4242 }) as unknown as ChildProcess
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  const client = {
    extensionEvents: createChildExtensionEvents(),
    stderrTail: "",
    send: (command: { readonly type?: string }) =>
      command.type === "get_state" && getState !== undefined
        ? getState()
        : Promise.resolve(
            command.type === "get_state"
              ? ({ success: true, command: "get_state", data: IDLE_STATE } as unknown as RpcResponse)
              : ({ success: true } as unknown as RpcResponse),
          ),
    onEvent: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    detach: () => listeners.clear(),
  } as unknown as RpcProtocolClient
  const handle = createRpcChildHandle({
    client,
    child,
    taskId: "st_00000002",
    heartbeatIntervalMs: settleConfirmMs,
    now: () => 1,
    settlementScheduler,
  }) as OutcomeTrackedHandle
  return {
    handle,
    emit: (record) => {
      for (const listener of listeners) listener(record as AgentSessionEvent)
    },
  }
}

function terminalProviderErrorTurn(): readonly unknown[] {
  const assistant = {
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: PROVIDER_TIMEOUT,
  }
  return [
    { type: "message_end", message: assistant },
    { type: "agent_end", willRetry: false, messages: [assistant] },
  ]
}

function successfulTurn(): readonly unknown[] {
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    stopReason: "stop",
  }
  return [
    { type: "message_end", message: assistant },
    { type: "agent_end", willRetry: false, messages: [assistant] },
    { type: "agent_idle" },
  ]
}

function goalTimer(armed: boolean, kind: string): unknown {
  return { type: "extension_event", name: "goal_continuation_timer_state", data: { armed, kind } }
}

function terminalMonitorState(activeCount: number, monitors: readonly unknown[]): unknown {
  return { type: "extension_event", name: "terminal_monitor_state", data: { activeCount, monitors } }
}

describe("createRpcChildHandle goal wake-source tracking (senpi#3262)", () => {
  test("#given an armed providerRetry timer over the raw event stream #when the turn ends on a terminal provider error #then the outcome stays pending while the timer holds", async () => {
    // given
    const scheduler = createManualSettlementScheduler()
    const harness = createHarness(60_000, scheduler.scheduler)
    let settled: RunnerOutcome | undefined
    void harness.handle.waitForOutcome().then((outcome) => {
      settled = outcome
    })
    harness.emit(goalTimer(true, "providerRetry"))

    // when - the turn ends on the stream-start timeout and never emits agent_idle
    for (const record of terminalProviderErrorTurn()) harness.emit(record)

    // then - firing the armed confirmation changes nothing: the goal's provider-outage wait owns the turn
    expect(scheduler.pending()).toBe(1)
    scheduler.runNext()
    await flushSettlement()
    expect(settled).toBeUndefined()
    await harness.handle.dispose()
  })

  test("#given the providerRetry timer disarms after the turn ended #when the confirmation re-fires #then the outcome settles failed with the provider text", async () => {
    // given - the same held error as above, then the goal's retry timer goes off
    const scheduler = createManualSettlementScheduler()
    const harness = createHarness(60_000, scheduler.scheduler)
    harness.emit(goalTimer(true, "providerRetry"))
    for (const record of terminalProviderErrorTurn()) harness.emit(record)
    scheduler.runNext()
    await flushSettlement()

    // when - the timer disarms: its disarm re-arms the confirmation, which then settles the failure
    harness.emit(goalTimer(false, "providerRetry"))

    // then
    expect(scheduler.pending()).toBe(1)
    scheduler.runNext()
    const outcome = await harness.handle.waitForOutcome()
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: PROVIDER_TIMEOUT },
    })
    await harness.handle.dispose()
  })

  test("#given a terminal monitor armed in an earlier turn #when a later turn ends on a terminal provider error #then the earlier monitor still holds the outcome", async () => {
    // given - turn 1 starts a session-lifetime terminal monitor, then ends clean on agent_idle
    const scheduler = createManualSettlementScheduler()
    const harness = createHarness(60_000, scheduler.scheduler)
    harness.emit(terminalMonitorState(1, [{ id: "w1", description: "watch the build", startedAtMs: 1 }]))
    for (const record of successfulTurn()) harness.emit(record)
    const first = await harness.handle.waitForOutcome()
    expect(first.status).toBe("completed")

    // when - a later self-resumed turn ends on a terminal provider error and never emits agent_idle
    harness.emit({ type: "agent_start" })
    let settled: RunnerOutcome | undefined
    void harness.handle.waitForOutcome().then((outcome) => {
      settled = outcome
    })
    for (const record of terminalProviderErrorTurn()) harness.emit(record)

    // then - firing the armed confirmation must not settle: turn 1's monitor still owns the session
    expect(scheduler.pending()).toBe(1)
    scheduler.runNext()
    await flushSettlement()
    expect(settled).toBeUndefined()

    // when - the earlier monitor finally ends, its disarm re-offers the confirmation
    harness.emit(terminalMonitorState(0, []))
    expect(scheduler.pending()).toBe(1)
    scheduler.runNext()

    // then - only then does the held error settle failed, with the provider's own text
    const outcome = await harness.handle.waitForOutcome()
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: PROVIDER_TIMEOUT },
    })
    await harness.handle.dispose()
  })

  test("#given the handle is disposed while the confirmation probe is in flight #when the probe rejects #then the turn is not reported failed", async () => {
    // given - get_state is held by the test so the dispose lands mid-flight
    const scheduler = createManualSettlementScheduler()
    const flight = Promise.withResolvers<RpcResponse>()
    const harness = createHarness(60_000, scheduler.scheduler, () => flight.promise)
    let settled: RunnerOutcome | undefined
    void harness.handle.waitForOutcome().then((outcome) => {
      settled = outcome
    })
    for (const record of terminalProviderErrorTurn()) harness.emit(record)
    expect(scheduler.pending()).toBe(1)
    scheduler.runNext()
    await flushSettlement()

    // when - the handle is disposed mid-flight, then the detach rejects the probe
    const disposed = harness.handle.dispose()
    flight.reject(new Error("detach refused get_state"))
    await flushSettlement()
    await disposed

    // then - the orphaned flight reported nothing: a cancel racing a held error is never failed
    expect(settled).toBeUndefined()
  })
})
