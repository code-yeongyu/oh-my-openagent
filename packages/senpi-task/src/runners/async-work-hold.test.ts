import { describe, expect, test } from "bun:test"

import { createAsyncWorkHold } from "./async-work-hold"
import type { RunnerOutcome } from "./in-process/child-handle"
import type { PendingAsyncWork } from "./pending-async-work"
import { createManualSettlementScheduler, flushSettlement } from "./rpc/turn-settlement.test-support"

const CELL: PendingAsyncWork = {
  sources: [{ source: "senpi-codemode", activeCount: 1, labels: ["eval cell"] }],
  children: 0,
}
const NOTE = { status: "completed", finalResponse: "waiting for the eval cell" } as const

/** The hold over scripted reads: `work` is what the engine reports, `idle` what each probe answers. */
function holdOver(
  idle: () => boolean | undefined,
  options?: { readonly staleLimitMs?: number; readonly wakeDeliveryGraceMs?: number },
) {
  const scheduler = createManualSettlementScheduler()
  let work: PendingAsyncWork | undefined = CELL
  let settled: RunnerOutcome | undefined
  const hold = createAsyncWorkHold({
    pending: () => work,
    idle: () => Promise.resolve(idle()),
    settle: (outcome) => {
      settled = outcome
    },
    schedule: scheduler.scheduler,
    intervalMs: 1_000,
    staleLimitMs: options?.staleLimitMs ?? 3_000,
    ...(options?.wakeDeliveryGraceMs === undefined ? {} : { wakeDeliveryGraceMs: options.wakeDeliveryGraceMs }),
  })
  hold.begin(NOTE, CELL)
  return {
    hold,
    scheduler,
    settled: () => settled,
    drain: () => {
      work = undefined
    },
    resume: () => {
      work = CELL
    },
    confirm: async () => {
      scheduler.runNext()
      await flushSettlement()
    },
  }
}

function expectTyped(outcome: RunnerOutcome | undefined, why: string): void {
  expect(outcome?.status).toBe("error")
  if (outcome?.status !== "error") throw new Error("expected the typed failure")
  expect(outcome.failure.kind).toBe("async_work_pending")
  expect(outcome.failure.message).toContain("senpi-codemode: 1 [eval cell]")
  expect(outcome.failure.message).toContain(why)
}

describe("createAsyncWorkHold never resolves to the held note (omo#10487)", () => {
  test("#given a hold whose work drained #when the session state stays unreadable past the limit #then it settles async_work_pending, not the held note", async () => {
    // given
    const h = holdOver(() => undefined)
    h.drain()

    // when - three unreadable reads (the default limit)
    await h.confirm()
    await h.confirm()
    expect(h.settled()).toBeUndefined()
    await h.confirm()

    // then
    expectTyped(h.settled(), "could not be read")
  })

  test("#given a hold whose work drained #when every read stays readable but not idle (queued input, no turn) #then the no-progress bound still ends it as async_work_pending", async () => {
    // given - the bound is 3 confirmations (3 s / 1 s), counted from the drain
    const h = holdOver(() => false)
    h.drain()

    // when - the first read sees the drain (progress), then three unchanged non-idle reads
    for (let check = 0; check < 3; check += 1) {
      await h.confirm()
      expect(h.settled()).toBeUndefined()
    }
    await h.confirm()

    // then
    expectTyped(h.settled(), "did not answer for 3 s")
    expect(h.scheduler.pending()).toBe(0)
  })
})

// The engine delivers a finished monitor's wake only after its notifier's coalescing window, while the
// work has already left its lifecycle: drained and idle is not "nothing woke the child" until a grace
// of continuous quiet has passed (3 confirmations here: 3 s / 1 s).
describe("createAsyncWorkHold waits out the engine's wake delivery before concluding nothing woke the child (omo#10487)", () => {
  const GRACE = { wakeDeliveryGraceMs: 3_000, staleLimitMs: 60_000 }

  async function quietReads(h: ReturnType<typeof holdOver>, reads: number): Promise<void> {
    for (let read = 0; read < reads; read += 1) {
      await h.confirm()
      expect(h.settled()).toBeUndefined()
    }
  }

  test("#given a hold whose work drained #when the session reads idle #then it settles nothing until the grace has passed, then async_work_pending", async () => {
    // given
    const h = holdOver(() => true, GRACE)
    h.drain()

    // when - the first drained+idle read opens the window, two more stay inside it
    await quietReads(h, 3)
    await h.confirm()

    // then - exactly one grace after the window opened, never later
    expectTyped(h.settled(), "nothing woke the child")
    expect(h.scheduler.pending()).toBe(0)
  })

  test("#given a drained idle hold inside the grace #when the wake turn starts and the caller cancels the hold #then it never settles", async () => {
    // given
    const h = holdOver(() => true, GRACE)
    h.drain()
    await quietReads(h, 2)

    // when
    h.hold.cancel()

    // then
    expect(h.scheduler.pending()).toBe(0)
    expect(h.settled()).toBeUndefined()
  })

  test("#given an open quiet window #when work reappears, the session reads busy, or the child shows activity #then the window restarts and the failure comes one full grace after the last quiet start", async () => {
    // given
    let idle = true
    const h = holdOver(() => idle, GRACE)
    h.drain()
    await quietReads(h, 2)

    // when - work reappears for one read, then drains again
    h.resume()
    await quietReads(h, 1)
    h.drain()
    await quietReads(h, 2)

    // when - the session reads busy for one read
    idle = false
    await quietReads(h, 1)
    idle = true
    await quietReads(h, 2)

    // when - the child shows activity
    h.hold.activity()
    await quietReads(h, 3)
    await h.confirm()

    // then
    expectTyped(h.settled(), "nothing woke the child")
  })
})
