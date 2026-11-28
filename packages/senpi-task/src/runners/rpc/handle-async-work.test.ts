import { describe, expect, test } from "bun:test"

import { FINAL_RESULT, lifecycleRecord, wokenTurn } from "../async-work.test-support"
import { STALE_CHECKS, harness } from "./handle-async-work.test-support"
import { flushSettlement } from "./turn-settlement.test-support"

describe("createRpcChildHandle pending async work from the engine lifecycle (omo#10487)", () => {
  test("#given the engine reports a detached cell #when the child ends its turn on a progress note #then the task is not completed", async () => {
    // given / when
    const h = harness()
    await h.endTurnWithDetachedCell()

    // then - nothing settled at the turn end, and a confirmation keeps it held
    expect(h.settled()).toBeUndefined()
    await h.confirm()
    expect(h.settled()).toBeUndefined()
    expect(h.scheduler.pending()).toBe(1)
    await h.handle.dispose()
  })

  test("#given a held turn #when the cell's completion wakes the child and it answers #then the task completes with that answer, not the progress note", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()
    let resumed = 0
    h.handle.onSelfResumed?.(() => {
      resumed += 1
    })

    // when - the cell finishes and its notification starts the real final turn
    h.setWaits(undefined)
    h.emit(lifecycleRecord())
    for (const record of wokenTurn(FINAL_RESULT)) h.emit(record)
    await flushSettlement()

    // then - the outcome the parent was already waiting on is the real answer, and the held turn's wake
    // is that turn's continuation, never announced as a run the child started on its own
    expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    expect(resumed).toBe(0)
    await h.handle.dispose()
  })

  test("#given a held turn whose work never settles #when the child keeps showing progress #then the bound restarts and the task stays running", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when - twice the bound in confirmations, each preceded by observable activity
    for (let check = 0; check < STALE_CHECKS * 2; check += 1) {
      h.emit({ type: "extension_event", name: "terminal_background_output", data: { id: "job-1" } })
      await h.confirm()
    }

    // then
    expect(h.settled()).toBeUndefined()
    expect(h.scheduler.pending()).toBe(1)
    await h.handle.dispose()
  })

  test("#given a held turn whose work never settles #when nothing progresses past the bound #then the task fails visibly as async_work_pending naming the cell", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when
    for (let check = 0; check < STALE_CHECKS; check += 1) await h.confirm()

    // then
    const outcome = h.settled()
    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    expect(outcome.failure.message).toContain("senpi-codemode: 1 [eval cell]")
    await h.handle.dispose()
  })
})
