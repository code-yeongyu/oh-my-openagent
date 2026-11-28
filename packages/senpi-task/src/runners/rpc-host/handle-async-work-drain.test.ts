import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { FINAL_RESULT, lifecycleRecord, wokenTurn } from "../async-work.test-support"
import { harness as processHarness } from "../rpc/handle-async-work.test-support"
import { flushSettlement } from "../rpc/turn-settlement.test-support"
import { harness as hostHarness } from "./handle-async-work.test-support"

function expectDrainedWithoutAnswer(outcome: RunnerOutcome | undefined): void {
  expect(outcome?.status).toBe("error")
  if (outcome?.status !== "error") throw new Error("expected the typed failure")
  expect(outcome.failure.kind).toBe("async_work_pending")
  expect(outcome.failure.message).toContain("nothing woke the child")
}

const ADAPTERS = [
  ["the process runner", processHarness],
  ["the shared-host runner", hostHarness],
] as const

/**
 * Review finding 1 on #15137 (omo#10487): a held turn whose work drained while no new turn started
 * has no answer. The progress note it held back is never the result - not on a repeated idle record,
 * not on the idle confirmation - and a turn the work's notification starts later supersedes it.
 */
for (const [runner, harness] of ADAPTERS) {
  describe(`a drained async-work hold on ${runner} (omo#10487)`, () => {
    test("#given a held turn #when its work drains and the idle record repeats with no new turn #then nothing settles until the confirmations past the wake-delivery grace, which report async_work_pending", async () => {
      // given
      const h = harness()
      await h.endTurnWithDetachedCell()

      // when - the engine reports the work gone and idles again, but starts no turn
      h.setWaits(undefined)
      h.emit(lifecycleRecord())
      h.emit({ type: "agent_idle" })
      await flushSettlement()

      // then - the repeated idle record is not an answer
      expect(h.settled()).toBeUndefined()

      // when - the confirmations read the drained, idle session for the whole wake-delivery grace
      await h.confirm()
      expect(h.settled()).toBeUndefined()
      await h.confirm()

      // then
      expectDrainedWithoutAnswer(h.settled())
      await h.handle.dispose()
    })

    test("#given a held turn whose monitor ended #when a confirmation reads the drained idle session before the monitor's wake arrives #then that wake turn's answer is the outcome, never async_work_pending", async () => {
      // given - the turn ended with the monitor live, and the monitor left the engine's lifecycle
      const h = harness()
      await h.endTurnWithDetachedCell()
      h.setWaits(undefined)
      h.emit(lifecycleRecord())
      await flushSettlement()

      // when - a confirmation lands inside the engine's coalescing window: drained and idle, no wake yet
      await h.confirm()
      expect(h.settled()).toBeUndefined()

      // when - the coalesced monitor event wakes the child and it answers
      for (const record of wokenTurn(FINAL_RESULT)) h.emit(record)
      await flushSettlement()

      // then
      expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
      await h.handle.dispose()
    })

    test("#given a drained hold reported as async_work_pending #when the work's notification starts a new turn #then that turn's answer is the next outcome", async () => {
      // given
      const h = harness()
      await h.endTurnWithDetachedCell()
      h.setWaits(undefined)
      await h.confirm()
      await h.confirm()
      expectDrainedWithoutAnswer(h.settled())
      let resumed = 0
      h.handle.onSelfResumed?.(() => {
        resumed += 1
      })

      // when
      for (const record of wokenTurn(FINAL_RESULT)) h.emit(record)
      await flushSettlement()

      // then
      expect(resumed).toBe(1)
      expect(await h.handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
      await h.handle.dispose()
    })
  })
}
