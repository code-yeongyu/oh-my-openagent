import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import {
  DETACHED_CELL_WAITS,
  FINAL_RESULT,
  PROGRESS_NOTE,
  cleanTurnEnd,
  lifecycleRecord,
  wokenTurn,
} from "../async-work.test-support"
import { harness as processHarness } from "../rpc/handle-async-work.test-support"
import { flushSettlement } from "../rpc/turn-settlement.test-support"
import { FAKE_SESSION } from "./handle.test-support"
import { harness as hostHarness } from "./handle-async-work.test-support"

function expectAbandonedCell(outcome: RunnerOutcome | undefined): void {
  expect(outcome?.status).toBe("error")
  if (outcome?.status !== "error") throw new Error("expected the typed failure")
  expect(outcome.failure.kind).toBe("async_work_pending")
  expect(outcome.failure.message).toContain("senpi-codemode: 1 [eval cell]")
}

type Harness = ReturnType<typeof processHarness> | ReturnType<typeof hostHarness>

/** The answer becomes provisional while the cell is pending; the cell then drains with no new turn. */
function noteThenDrain(h: Harness): void {
  h.emit(lifecycleRecord(DETACHED_CELL_WAITS))
  const [messageEnd, agentEnd] = cleanTurnEnd(PROGRESS_NOTE)
  h.emit(messageEnd)
  h.emit(agentEnd)
  h.setWaits(undefined)
  h.emit(lifecycleRecord())
}

const ADAPTERS = [
  ["the process runner", processHarness],
  ["the shared-host runner", hostHarness],
] as const

/**
 * Delta review 3 on #15137 (omo#10487): pending-work evidence has a window. It is positive when work
 * was pending at the turn's end or any time after, until a new agent_start supersedes the answer; a
 * later zero snapshot never clears it. Whether the work drains just before or just after agent_idle
 * (or before an exit, a park or a teardown) must make no difference: the note is never the result.
 */
for (const [runner, harness] of ADAPTERS) {
  describe(`the pending-work window on ${runner} (omo#10487)`, () => {
    test("#given work pending at the turn's end #when it drains before agent_idle and no turn starts #then the note is held and the confirmation reports async_work_pending", async () => {
      // given
      const h = harness()
      noteThenDrain(h)

      // when
      h.emit({ type: "agent_idle" })
      await flushSettlement()

      // then - not the note; the hold's confirmation reads the drained, idle session
      expect(h.settled()).toBeUndefined()
      await h.confirm()
      expectAbandonedCell(h.settled())
      await h.handle.dispose()
    })

    test("#given work pending at the turn's end #when it drains and a new turn answers with nothing pending #then that answer completes", async () => {
      // given
      const h = harness()
      noteThenDrain(h)

      // when
      for (const record of wokenTurn(FINAL_RESULT)) h.emit(record)
      await flushSettlement()

      // then
      expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
      await h.handle.dispose()
    })

    test("#given no work at any point #when the turn ends and idles #then it completes at once, with no confirmation armed", async () => {
      // given
      const h = harness()
      h.setWaits(undefined)
      h.emit(lifecycleRecord())

      // when
      for (const record of cleanTurnEnd(FINAL_RESULT)) h.emit(record)
      await flushSettlement()

      // then
      expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
      expect(h.scheduler.pending()).toBe(0)
      await h.handle.dispose()
    })
  })
}

describe("the pending-work window when the session ends before agent_idle (omo#10487)", () => {
  test("#given the process runner #when the work drains and then the child exits #then the outcome is async_work_pending", async () => {
    const h = processHarness()
    noteThenDrain(h)
    h.child.emit("close", 0, null)
    expectAbandonedCell(await h.handle.waitForOutcome())
  })

  test("#given the process runner #when the work drains and then the handle is disposed and the child exits #then the outcome is async_work_pending", async () => {
    const h = processHarness()
    noteThenDrain(h)
    await h.handle.dispose()
    h.child.emit("close", 0, null)
    expectAbandonedCell(await h.handle.waitForOutcome())
  })

  test("#given the shared-host runner #when the work drains and then the parent closes the session #then the outcome is async_work_pending", async () => {
    const h = hostHarness()
    noteThenDrain(h)
    await h.handle.close()
    expectAbandonedCell(await h.handle.waitForOutcome())
  })

  test("#given the shared-host runner #when the work drains and then the host parks the session #then the outcome is async_work_pending", async () => {
    const h = hostHarness()
    noteThenDrain(h)
    h.port.emitParked({
      sessionId: FAKE_SESSION.routingId,
      sessionPath: FAKE_SESSION.sessionPath,
      reason: "idle_evicted",
    })
    await flushSettlement()
    expectAbandonedCell(h.settled())
    await h.handle.detach()
  })

  test("#given the shared-host runner #when the work drains and then the parent terminates it #then the turn is cancelled", async () => {
    const h = hostHarness()
    noteThenDrain(h)
    await h.handle.terminate()
    expect(await h.handle.waitForOutcome()).toEqual({ status: "cancelled" })
  })
})
