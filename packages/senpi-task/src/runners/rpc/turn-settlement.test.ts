import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { createTurnSettlement, type TurnSettlementProbe } from "./turn-settlement"
import { createManualSettlementScheduler, flushSettlement } from "./turn-settlement.test-support"

const PROVIDER_TIMEOUT = "Provider stream start timed out after 300000ms"

function agentEnd(errorMessage: string): unknown {
  return {
    type: "agent_end",
    willRetry: false,
    messages: [
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage,
      },
    ],
  }
}

function idleState(): TurnSettlementProbe {
  return { isStreaming: false, steering: [], followUp: [], pendingMessageCount: 0 }
}

function busyState(): TurnSettlementProbe {
  return { isStreaming: true, steering: [], followUp: [], pendingMessageCount: 0 }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createFixture(options?: {
  readonly probe?: () => Promise<TurnSettlementProbe | undefined>
  readonly wakeSourcesLive?: () => boolean
  readonly disposed?: () => boolean
  readonly maxUnreadableProbes?: number
}) {
  const scheduler = createManualSettlementScheduler()
  let settled: RunnerOutcome | undefined
  const waiters: Array<(outcome: RunnerOutcome) => void> = []
  const settlement = createTurnSettlement({
    settle: (outcome) => {
      settled = outcome
      for (const waiter of waiters.splice(0)) waiter(outcome)
    },
    abortedByUser: () => false,
    baseline: () => undefined,
    finalText: () => undefined,
    probe: options?.probe,
    settleConfirmMs: 60_000,
    maxUnreadableProbes: options?.maxUnreadableProbes,
    wakeSourcesLive: options?.wakeSourcesLive,
    disposed: options?.disposed,
    scheduleConfirmation: scheduler.scheduler,
  })
  return {
    settlement,
    scheduler,
    settled: () => settled,
    nextSettled: () => new Promise<RunnerOutcome>((resolve) => waiters.push(resolve)),
  }
}

function countingProbe(answer: () => TurnSettlementProbe | undefined) {
  let calls = 0
  return {
    calls: () => calls,
    probe: () => {
      calls += 1
      return Promise.resolve(answer())
    },
  }
}

function queueProbe(answers: readonly (TurnSettlementProbe | undefined)[]) {
  let calls = 0
  return {
    calls: () => calls,
    probe: () => {
      const answer = answers[Math.min(calls, answers.length - 1)]
      calls += 1
      return Promise.resolve(answer)
    },
  }
}

describe("createTurnSettlement terminal provider error (senpi#3262)", () => {
  test("#given a terminal provider error whose idle event never arrives and no wake source lives #when the settle confirmation fires #then the outcome settles failed with the provider's own text", async () => {
    // given
    const probe = countingProbe(idleState)
    const fixture = createFixture({ probe: probe.probe, wakeSourcesLive: () => false })

    // when - the turn ends terminally and the session never emits agent_idle
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)

    // then - the armed confirmation probes, finds the session idle, and settles the held error
    expect(fixture.scheduler.pending()).toBe(1)
    const settled = fixture.nextSettled()
    fixture.scheduler.runNext()
    const outcome = await settled
    expect(probe.calls()).toBe(1)
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: PROVIDER_TIMEOUT },
    })
  })

  test("#given a terminal provider error while a goal continuation timer is armed #when the confirmation fires #then the held outcome never settles and a later agent_start clears it", async () => {
    // given
    const probe = countingProbe(idleState)
    let wakeLive = true
    const fixture = createFixture({ probe: probe.probe, wakeSourcesLive: () => wakeLive })

    // when - the turn ends terminally; its wake tracker says a goal owns the recovery
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)

    // then - the armed confirmation sees the live wake and holds: no probe, no re-arm, no settle
    expect(fixture.scheduler.pending()).toBe(1)
    fixture.scheduler.runNext()
    await flushSettlement()
    expect(probe.calls()).toBe(0)
    expect(fixture.scheduler.pending()).toBe(0)
    expect(fixture.settled()).toBeUndefined()

    // when - the goal continuation actually starts a new turn
    wakeLive = false
    fixture.settlement.observe({ type: "agent_start" } as never)

    // then - the held outcome is dropped for the new turn
    await flushSettlement()
    expect(fixture.settled()).toBeUndefined()
  })

  test("#given a terminal provider error whose probe reports an active turn #when it later reports true idleness #then only the idle answer settles the held outcome", async () => {
    // given
    let idle = false
    const probe = countingProbe(() => (idle ? idleState() : busyState()))
    const fixture = createFixture({ probe: probe.probe, wakeSourcesLive: () => false })

    // when - the confirmation's first probe finds the session still busy
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    fixture.scheduler.runNext()
    await flushSettlement()

    // then - the busy answer settled nothing and re-armed the confirmation
    expect(probe.calls()).toBe(1)
    expect(fixture.scheduler.pending()).toBe(1)
    expect(fixture.settled()).toBeUndefined()

    // when - the next probe finds the session truly idle
    idle = true
    const settled = fixture.nextSettled()
    fixture.scheduler.runNext()

    // then
    const outcome = await settled
    expect(probe.calls()).toBe(2)
    expect(outcome.status).toBe("error")
  })

  test("#given the regular path #when agent_idle arrives after a terminal agent_end #then the outcome settles immediately without probing", () => {
    // given
    const probe = countingProbe(idleState)
    const fixture = createFixture({ probe: probe.probe, wakeSourcesLive: () => false })

    // when
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    fixture.settlement.observe({ type: "agent_idle" } as never)

    // then - idle is the one true signal: the armed confirmation was cancelled before firing
    expect(fixture.scheduler.pending()).toBe(0)
    expect(probe.calls()).toBe(0)
    expect(fixture.settled()).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: PROVIDER_TIMEOUT },
    })
  })

  test("#given a held error whose wake source later disarms #when reconfirmHeld runs #then the idle confirmation settles it failed", async () => {
    // given - a goal's providerRetry timer held the outcome at the first confirmation
    const probe = countingProbe(idleState)
    let wakeLive = true
    const fixture = createFixture({ probe: probe.probe, wakeSourcesLive: () => wakeLive })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    fixture.scheduler.runNext()
    await flushSettlement()
    expect(probe.calls()).toBe(0)
    expect(fixture.settled()).toBeUndefined()

    // when - the timer disarms and the handle's observation hook re-offers the confirmation
    wakeLive = false
    fixture.settlement.reconfirmHeld()

    // then - the re-armed confirmation probes, finds the session idle, and settles the failure
    expect(fixture.scheduler.pending()).toBe(1)
    const settled = fixture.nextSettled()
    fixture.scheduler.runNext()
    const outcome = await settled
    expect(probe.calls()).toBe(1)
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: PROVIDER_TIMEOUT },
    })
  })

  test("#given a probe that rejects #when the settle confirmation runs #then the held outcome still settles failed (the error text is already known)", async () => {
    // given
    const fixture = createFixture({
      probe: () => Promise.reject(new Error("get_state refused")),
      wakeSourcesLive: () => false,
    })

    // when
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    const settled = fixture.nextSettled()
    fixture.scheduler.runNext()

    // then
    const outcome = await settled
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: PROVIDER_TIMEOUT },
    })
  })

  test("#given a probe that cannot read the session state #when the unreadable answers reach the bound #then the held error settles instead of re-arming forever", async () => {
    // given - get_state keeps answering non-success: the probe reads undefined
    const probe = countingProbe(() => undefined)
    const fixture = createFixture({ probe: probe.probe, wakeSourcesLive: () => false, maxUnreadableProbes: 3 })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)

    // when - the first two unreadable answers only re-arm the confirmation
    fixture.scheduler.runNext()
    await flushSettlement()
    fixture.scheduler.runNext()
    await flushSettlement()
    expect(probe.calls()).toBe(2)
    expect(fixture.scheduler.pending()).toBe(1)
    expect(fixture.settled()).toBeUndefined()

    // then - the third consecutive unreadable answer settles the known error
    const settled = fixture.nextSettled()
    fixture.scheduler.runNext()
    const outcome = await settled
    expect(probe.calls()).toBe(3)
    expect(outcome).toEqual({
      status: "error",
      failure: { kind: "child-turn-failed", message: PROVIDER_TIMEOUT },
    })
  })

  test("#given unreadable probes around a readable busy answer #when the unreadable run restarts #then the bound counts only consecutive unreadable answers", async () => {
    // given - unreadable, unreadable, a READABLE busy answer, then unreadable again
    const probe = queueProbe([undefined, undefined, busyState(), undefined, undefined])
    const fixture = createFixture({ probe: probe.probe, wakeSourcesLive: () => false, maxUnreadableProbes: 3 })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)

    // when - all five confirmations fire
    for (let round = 0; round < 5; round += 1) {
      fixture.scheduler.runNext()
      await flushSettlement()
    }

    // then - the busy answer reset the run: 2 + 2 consecutive unreadable answers settled nothing
    expect(probe.calls()).toBe(5)
    expect(fixture.scheduler.pending()).toBe(1)
    expect(fixture.settled()).toBeUndefined()

    // when - the third consecutive unreadable answer lands
    const settled = fixture.nextSettled()
    fixture.scheduler.runNext()

    // then
    const outcome = await settled
    expect(probe.calls()).toBe(6)
    expect(outcome.status).toBe("error")
  })

  test("#given the handle is disposed while a probe is in flight #when the probe then answers idle #then the held error is not reported failed", async () => {
    // given - the probe flight is held by the test so disposal lands mid-flight
    const flight = deferred<TurnSettlementProbe>()
    let tornDown = false
    const fixture = createFixture({ probe: () => flight.promise, disposed: () => tornDown, wakeSourcesLive: () => false })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    fixture.scheduler.runNext()
    await flushSettlement()

    // when - teardown disposes the handle while the probe is still out, then the idle answer arrives
    tornDown = true
    flight.resolve(idleState())
    await flushSettlement()

    // then - the orphaned flight settles nothing: the exit path owns the outcome from here
    expect(fixture.settled()).toBeUndefined()
  })

  test("#given the handle is disposed while a probe is in flight #when the probe then rejects #then the held error is not reported failed", async () => {
    // given
    const flight = deferred<TurnSettlementProbe>()
    let tornDown = false
    const fixture = createFixture({ probe: () => flight.promise, disposed: () => tornDown, wakeSourcesLive: () => false })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    fixture.scheduler.runNext()
    await flushSettlement()

    // when - the detach rejects the in-flight probe after disposal
    tornDown = true
    flight.reject(new Error("detach refused get_state"))
    await flushSettlement()

    // then - a cancel racing a held error is never misreported as failed
    expect(fixture.settled()).toBeUndefined()
  })

  test("#given a wake source comes live while a probe is in flight #when the probe then answers idle #then the held error stays held", async () => {
    // given
    const flight = deferred<TurnSettlementProbe>()
    let wakeLive = false
    const fixture = createFixture({ probe: () => flight.promise, wakeSourcesLive: () => wakeLive })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    fixture.scheduler.runNext()
    await flushSettlement()

    // when - a goal timer arms mid-flight (a recovery now owns the session), then the answer lands
    wakeLive = true
    flight.resolve(idleState())
    await flushSettlement()

    // then
    expect(fixture.settled()).toBeUndefined()
  })

  test("#given a wake source comes live while a probe is in flight #when the probe then rejects #then the held error stays held", async () => {
    // given
    const flight = deferred<TurnSettlementProbe>()
    let wakeLive = false
    const fixture = createFixture({ probe: () => flight.promise, wakeSourcesLive: () => wakeLive })
    fixture.settlement.observe(agentEnd(PROVIDER_TIMEOUT) as never)
    fixture.scheduler.runNext()
    await flushSettlement()

    // when
    wakeLive = true
    flight.reject(new Error("get_state refused"))
    await flushSettlement()

    // then - the wake source owns the turn: nothing settles
    expect(fixture.settled()).toBeUndefined()
  })
})
