import { describe, expect, test } from "bun:test"

import { FINAL_RESULT } from "../async-work.test-support"
import { createManualSettlementScheduler, flushSettlement } from "../rpc/turn-settlement.test-support"
import { assistantEnd, heldWorkSession } from "./__fixtures__/held-work-session"
import { createChildHandle, type RunnerOutcome } from "./child-handle"

const INTERVAL_MS = 1_000
const STALE_LIMIT_MS = 5_000
const STALE_CHECKS = 5
// The wake-delivery grace as confirmations: the first drained+idle read opens it, three more close it.
const GRACE_MS = 3_000
const GRACE_CHECKS = 3

/**
 * The in-process runner (the `auto` fallback) over a session that behaves like senpi's
 * AgentSession (held-work-session.ts). Before omo#10487 this runner settled every clean turn on
 * `prompt()` resolution and never looked at the lifecycle.
 */
function harness() {
  const scheduler = createManualSettlementScheduler()
  const fake = heldWorkSession()
  const handle = createChildHandle({
    taskId: "st_10487_inproc",
    session: fake.session,
    promptText: "run the delayed eval, then answer FINAL-RESULT",
    asyncWork: {
      schedule: scheduler.scheduler,
      intervalMs: INTERVAL_MS,
      staleLimitMs: STALE_LIMIT_MS,
      wakeDeliveryGraceMs: GRACE_MS,
    },
  })
  let settled: RunnerOutcome | undefined
  void handle.waitForIdle().then((outcome) => {
    settled = outcome
  })
  return {
    handle,
    scheduler,
    emit: fake.emit,
    settled: () => settled,
    setWaits: fake.setWaits,
    confirm: async () => {
      scheduler.runNext()
      await flushSettlement()
    },
    endTurnWithDetachedCell: async () => {
      fake.endTurnWithDetachedCell()
      await flushSettlement()
    },
  }
}

describe("createChildHandle pending async work from the engine lifecycle (omo#10487)", () => {
  test("#given the session still owns a detached cell #when its prompt resolves on a progress note #then the task is not completed", async () => {
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

  test("#given a held turn #when the cell's completion starts an engine turn that answers #then the task completes with that answer, not the progress note", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when - the cell finishes and its notification starts the real final turn
    h.setWaits(undefined)
    h.emit({ type: "agent_start" })
    h.emit(assistantEnd(FINAL_RESULT))
    h.emit({ type: "agent_end" })
    await flushSettlement()

    // then - the outcome the parent was already waiting on is the real answer
    expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    await h.handle.dispose()
  })

  test("#given a held turn #when the cell finishes but the print-mode engine never wakes the child #then the task fails visibly as async_work_pending, not completed with the note", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when - the work drains and the session idles with no engine turn for the whole grace
    h.setWaits(undefined)
    for (let check = 0; check < GRACE_CHECKS; check += 1) {
      await h.confirm()
      expect(h.settled()).toBeUndefined()
    }
    await h.confirm()

    // then
    const outcome = h.settled()
    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    expect(outcome.failure.message).toContain("nothing woke the child")
    await h.handle.dispose()
  })

  test("#given a held turn whose monitor ended #when a confirmation reads the drained idle session before the monitor's wake arrives #then that wake turn's answer is the outcome, never async_work_pending", async () => {
    // given - the turn ended with the monitor live, and the monitor left the engine's lifecycle
    const h = harness()
    await h.endTurnWithDetachedCell()
    h.setWaits(undefined)

    // when - a confirmation lands inside the engine's coalescing window: drained and idle, no wake yet
    await h.confirm()
    expect(h.settled()).toBeUndefined()

    // when - the coalesced monitor event wakes the child and it answers
    h.emit({ type: "agent_start" })
    h.emit(assistantEnd(FINAL_RESULT))
    h.emit({ type: "agent_end" })
    await flushSettlement()

    // then
    expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    await h.handle.dispose()
  })

  test("#given a held turn whose work never settles #when the session keeps showing progress #then the bound restarts and the task stays running", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when - twice the bound in confirmations, each preceded by observable activity
    for (let check = 0; check < STALE_CHECKS * 2; check += 1) {
      h.emit({ type: "extension_event" })
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

  test("#given a held turn whose work woke the child #when the child is disposed before the wake turn answers #then the outcome is async_work_pending, never the held note", async () => {
    // given - the cell finished and its notification started the wake turn
    const h = harness()
    await h.endTurnWithDetachedCell()
    h.setWaits(undefined)
    h.emit({ type: "agent_start" })

    // when - teardown lands before that turn's agent_end (delta review HIGH 2 on #15137)
    await h.handle.dispose()
    await flushSettlement()

    // then
    const outcome = h.settled()
    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    expect(outcome.failure.message).toContain("senpi-codemode: 1 [eval cell]")
  })

  test("#given a held turn #when the parent aborts the child #then the outcome is cancelled, not the abandoned work", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when
    await h.handle.abort()
    await flushSettlement()

    // then
    expect(h.settled()).toEqual({ status: "cancelled" })
    await h.handle.dispose()
  })
})
