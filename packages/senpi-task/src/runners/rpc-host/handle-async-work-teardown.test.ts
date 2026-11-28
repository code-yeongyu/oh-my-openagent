import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { harness as processHarness } from "../rpc/handle-async-work.test-support"
import { flushSettlement } from "../rpc/turn-settlement.test-support"
import { FAKE_SESSION } from "./handle.test-support"
import { harness } from "./handle-async-work.test-support"

function expectAbandonedCell(outcome: RunnerOutcome | undefined): void {
  expect(outcome?.status).toBe("error")
  if (outcome?.status !== "error") throw new Error("expected the typed failure")
  expect(outcome.failure.kind).toBe("async_work_pending")
  expect(outcome.failure.message).toContain("senpi-codemode: 1 [eval cell]")
}

/**
 * Review finding 3 on #15137 (omo#10487): a turn held on the child's own async work that ends by
 * teardown is the abandoned work's typed outcome, never the progress note the hold was keeping back.
 * Teardown used to clear the hold before the exit read what the turn amounted to.
 */
describe("a turn held on pending async work ends by teardown (omo#10487)", () => {
  test("#given a held host-session turn #when the parent closes the session #then waitForOutcome is async_work_pending and no confirmation stays armed", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when
    await h.handle.close()

    // then
    expectAbandonedCell(await h.handle.waitForOutcome())
    expect(h.scheduler.pending()).toBe(0)
  })

  test("#given a held host-session turn #when the parent terminates it #then the turn is cancelled, not completed and not a failure", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when
    await h.handle.terminate()

    // then
    expect(await h.handle.waitForOutcome()).toEqual({ status: "cancelled" })
    expect(h.scheduler.pending()).toBe(0)
  })

  test("#given a held host-session turn #when the host parks the session #then the turn is async_work_pending and the hold is disarmed", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when
    h.port.emitParked({
      sessionId: FAKE_SESSION.routingId,
      sessionPath: FAKE_SESSION.sessionPath,
      reason: "idle_evicted",
    })
    await flushSettlement()

    // then
    expectAbandonedCell(h.settled())
    expect(h.scheduler.pending()).toBe(0)
    await h.handle.detach()
  })

  test("#given a held process-runner turn #when the handle is disposed and the child then exits #then waitForOutcome is async_work_pending", async () => {
    // given
    const h = processHarness()
    await h.endTurnWithDetachedCell()

    // when
    await h.handle.dispose()
    h.child.emit("close", 0, null)

    // then
    expectAbandonedCell(await h.handle.waitForOutcome())
    expect(h.scheduler.pending()).toBe(0)
  })
})
