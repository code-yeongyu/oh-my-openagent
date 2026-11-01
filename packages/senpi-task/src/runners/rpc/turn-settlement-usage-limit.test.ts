import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { createTurnSettlement, type TurnSettlementProbe } from "./turn-settlement"
import { createTurnWakeSources } from "./turn-wake-sources"
import { createManualSettlementScheduler, flushSettlement } from "./turn-settlement.test-support"

// senpi's own rewrite of a limit whose body names no model (omo#9711, omo#11383).
const ACCOUNT_LIMIT =
  "The anthropic account usage limit has been reached (resets at 2026-10-27T11:03:15Z). Switch to another provider with /model, or configure another provider in retry.fallbackChains."
const PROVIDER_TIMEOUT = "Provider stream start timed out after 300000ms"

function agentEnd(errorMessage: string, willRetry: boolean): unknown {
  return { type: "agent_end", willRetry, messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage }] }
}

function completedEnd(): unknown {
  return { type: "agent_end", willRetry: false, messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }] }
}

const idle = (): Promise<TurnSettlementProbe> =>
  Promise.resolve({ isStreaming: false, isCompacting: false, steering: [], followUp: [], pendingMessageCount: 0 })

function createFixture(options: { readonly monitorLive: boolean }) {
  const wakes = createTurnWakeSources()
  if (options.monitorLive) {
    wakes.observe({ type: "extension_event", name: "terminal_monitor_state", data: { activeCount: 1, monitors: [{ id: "mon_1" }] } })
  }
  const scheduler = createManualSettlementScheduler()
  const settled: RunnerOutcome[] = []
  const settlement = createTurnSettlement({
    settle: (outcome) => { settled.push(outcome) },
    abortedByUser: () => false,
    baseline: () => undefined,
    finalText: () => undefined,
    probe: idle,
    settleConfirmMs: 10_000,
    wakeSourcesLive: () => wakes.hasLiveWakeSources(),
    scheduleConfirmation: scheduler.scheduler,
  })
  return { settlement, scheduler, settled }
}

describe("a usage-limit error settles within one confirmation interval (omo#9711)", () => {
  test.each([
    { type: "auto_retry_start", delayMs: 45_000 },
    { type: "agent_end", delayMs: 45_000 },
  ])("an announced delayed retry retains its full backoff and completes: %p", (delayEvent) => {
    const fixture = createFixture({ monitorLive: false })
    fixture.settlement.observe({ ...agentEnd(ACCOUNT_LIMIT, true) as object, ...(delayEvent.type === "agent_end" ? delayEvent : {}) } as never)
    if (delayEvent.type !== "agent_end") fixture.settlement.observe(delayEvent as never)
    expect(fixture.scheduler.nextDelay()).toBe(55_000)
    expect(fixture.settled).toEqual([])
    fixture.settlement.observe({ type: "agent_start" } as never)
    fixture.settlement.observe(completedEnd() as never)
    fixture.settlement.observe({ type: "agent_idle" } as never)
    expect(fixture.settled).toEqual([{ status: "completed", finalResponse: "done" }])
    expect(fixture.scheduler.pending()).toBe(0)
  })

  test("a usage limit with Retry-After seconds honors the stated delay", () => {
    const fixture = createFixture({ monitorLive: false })
    fixture.settlement.observe(agentEnd(`${ACCOUNT_LIMIT} Retry-After: 45`, true) as never)
    expect(fixture.scheduler.nextDelay()).toBe(55_000)
  })

  test.each([false, true])("#given a terminal usage-limit end (monitor live: %p) #when the confirmation fires #then the turn settles failed with the provider's reason", async (monitorLive) => {
    // given
    const fixture = createFixture({ monitorLive })

    // when
    fixture.settlement.observe(agentEnd(ACCOUNT_LIMIT, false) as never)
    fixture.scheduler.runNext()
    await flushSettlement()

    // then
    expect(fixture.settled).toEqual([{ status: "error", failure: { kind: "child-turn-failed", message: ACCOUNT_LIMIT } }])
    expect(fixture.scheduler.pending()).toBe(0)
  })

  test("#given the engine announces a retry on a usage limit #when no run starts before the confirmation #then the turn settles failed", async () => {
    // given
    const fixture = createFixture({ monitorLive: false })

    // when - one agent_end { willRetry: true }, then nothing
    fixture.settlement.observe(agentEnd(ACCOUNT_LIMIT, true) as never)
    expect(fixture.scheduler.pending()).toBe(1)
    fixture.scheduler.runNext()
    await flushSettlement()

    // then
    expect(fixture.settled).toEqual([{ status: "error", failure: { kind: "child-turn-failed", message: ACCOUNT_LIMIT } }])
  })

  test("#given the engine announces a retry on a usage limit #when the retry run starts and completes #then the completed outcome is the turn's", () => {
    // given
    const fixture = createFixture({ monitorLive: false })

    // when
    fixture.settlement.observe(agentEnd(ACCOUNT_LIMIT, true) as never)
    fixture.settlement.observe({ type: "agent_start" } as never)
    fixture.settlement.observe(completedEnd() as never)
    fixture.settlement.observe({ type: "agent_idle" } as never)

    // then
    expect(fixture.scheduler.pending()).toBe(0)
    expect(fixture.settled).toEqual([{ status: "completed", finalResponse: "done" }])
  })

  test("#given a held usage-limit error #when a monitor wake starts a run that hits the spent account again #then that end settles failed at once", () => {
    // given
    const fixture = createFixture({ monitorLive: true })
    fixture.settlement.observe(agentEnd(ACCOUNT_LIMIT, false) as never)

    // when
    fixture.settlement.observe({ type: "agent_start" } as never)
    fixture.settlement.observe(agentEnd(ACCOUNT_LIMIT, false) as never)

    // then - no second wait, nothing left armed
    expect(fixture.settled).toHaveLength(1)
    expect(fixture.settled[0]?.status).toBe("error")
    expect(fixture.scheduler.pending()).toBe(0)
  })

  test("#given a non-limit error held by a live monitor #when the confirmation fires #then it re-arms instead of giving up", async () => {
    // given
    const fixture = createFixture({ monitorLive: true })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT, false) as never)

    // when
    fixture.scheduler.runNext()
    await flushSettlement()

    // then
    expect(fixture.settled).toEqual([])
    expect(fixture.scheduler.pending()).toBe(1)
  })
})
