import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import { DETACHED_CELL_WAITS, PROGRESS_NOTE, cleanTurnEnd, lifecycleRecord } from "../async-work.test-support"
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

/** The turn ends on `answer` (message_end, agent_end) and the session goes before agent_idle. */
function endTurnWithoutIdle(emit: (record: unknown) => void, answer: string, waits?: unknown): void {
  emit(lifecycleRecord(waits))
  const [messageEnd, agentEnd] = cleanTurnEnd(answer)
  emit(messageEnd)
  emit(agentEnd)
}

/**
 * Delta review 2 HIGH 2 on #15137 (omo#10487): the hold starts at agent_idle, but a session can end
 * between agent_end and agent_idle. The pending work the engine already reported decides what the
 * turn amounts to then: the abandoned work, or cancelled when the parent terminated it - never the
 * progress note. A turn that left no work pending still completes with its answer.
 */
describe("a turn that ends on a note while its work is pending, before agent_idle (omo#10487)", () => {
  test("#given the process runner #when the child exits before agent_idle #then the outcome is async_work_pending", async () => {
    // given
    const h = processHarness()
    endTurnWithoutIdle(h.emit, PROGRESS_NOTE, DETACHED_CELL_WAITS)

    // when
    h.child.emit("close", 0, null)

    // then
    expectAbandonedCell(await h.handle.waitForOutcome())
  })

  test("#given the shared-host runner #when the parent closes the session before agent_idle #then the outcome is async_work_pending", async () => {
    // given
    const h = hostHarness()
    endTurnWithoutIdle(h.emit, PROGRESS_NOTE, DETACHED_CELL_WAITS)

    // when
    await h.handle.close()

    // then
    expectAbandonedCell(await h.handle.waitForOutcome())
  })

  test("#given the shared-host runner #when the host parks the session before agent_idle #then the outcome is async_work_pending", async () => {
    // given
    const h = hostHarness()
    endTurnWithoutIdle(h.emit, PROGRESS_NOTE, DETACHED_CELL_WAITS)

    // when
    h.port.emitParked({
      sessionId: FAKE_SESSION.routingId,
      sessionPath: FAKE_SESSION.sessionPath,
      reason: "idle_evicted",
    })
    await flushSettlement()

    // then
    expectAbandonedCell(h.settled())
    await h.handle.detach()
  })

  test("#given the shared-host runner #when the parent terminates it before agent_idle #then the turn is cancelled", async () => {
    // given
    const h = hostHarness()
    endTurnWithoutIdle(h.emit, PROGRESS_NOTE, DETACHED_CELL_WAITS)

    // when
    await h.handle.terminate()

    // then
    expect(await h.handle.waitForOutcome()).toEqual({ status: "cancelled" })
  })

  test("#given a turn that left no work pending #when the process child exits before agent_idle #then it completes with its answer", async () => {
    // given
    const h = processHarness()
    endTurnWithoutIdle(h.emit, "all green")

    // when
    h.child.emit("close", 0, null)

    // then
    expect(await h.handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: "all green" })
  })

  test("#given a turn that left no work pending #when the host closes the session before agent_idle #then it completes with its answer", async () => {
    // given
    const h = hostHarness()
    endTurnWithoutIdle(h.emit, "all green")

    // when
    await h.handle.close()

    // then
    expect(await h.handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: "all green" })
  })

  test("#given the process runner #when the child exits after the note's message_end but before agent_end #then the outcome is async_work_pending", async () => {
    // given - the streamed note is the only text; no agent_end ever held an outcome
    const h = processHarness()
    h.emit(lifecycleRecord(DETACHED_CELL_WAITS))
    h.emit(cleanTurnEnd(PROGRESS_NOTE)[0])

    // when
    h.child.emit("close", 0, null)

    // then
    expectAbandonedCell(await h.handle.waitForOutcome())
  })

  test("#given the shared-host runner #when the parent closes the session after the note's message_end but before agent_end #then the outcome is async_work_pending", async () => {
    // given
    const h = hostHarness()
    h.emit(lifecycleRecord(DETACHED_CELL_WAITS))
    h.emit(cleanTurnEnd(PROGRESS_NOTE)[0])

    // when
    await h.handle.close()

    // then
    expectAbandonedCell(await h.handle.waitForOutcome())
  })
})
