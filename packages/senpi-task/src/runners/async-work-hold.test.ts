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
function holdOver(idle: () => boolean | undefined, options?: { readonly staleLimitMs?: number }) {
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
  })
  hold.begin(NOTE, CELL)
  return {
    scheduler,
    settled: () => settled,
    drain: () => {
      work = undefined
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
