import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import {
  DETACHED_CELL_WAITS,
  FINAL_RESULT,
  PROGRESS_NOTE,
  cleanTurnEnd,
  lifecycleRecord,
  lifecycleSnapshot,
  wokenTurn,
} from "../async-work.test-support"
import { createManualSettlementScheduler, flushSettlement } from "../rpc/turn-settlement.test-support"
import { createHostSessionHandle } from "./handle"
import { FAKE_SESSION, event, fakeSessionPort } from "./handle.test-support"

// 600 s confirmations against the 60 min default bound: six confirmations without progress.
const HEARTBEAT_MS = 600_000
const STALE_CHECKS = 6

/**
 * The shared-host runner over an in-memory session. The pending work reaches it only through the
 * engine's lifecycle: the host's session worker forwards no `wake_source_state` extension event, so
 * the earlier wake-source-only hold never engaged on this path (omo#10487).
 */
function harness() {
  const scheduler = createManualSettlementScheduler()
  let waits: unknown = DETACHED_CELL_WAITS
  const port = fakeSessionPort()
  const handle = createHostSessionHandle({
    client: {
      ...port,
      getState: () =>
        Promise.resolve({
          sessionId: "durable-1",
          isStreaming: false,
          steering: [],
          followUp: [],
          pendingMessageCount: 0,
          lifecycle: lifecycleSnapshot(waits),
        }),
    },
    session: FAKE_SESSION,
    taskId: "st_10487_host",
    heartbeatIntervalMs: HEARTBEAT_MS,
    now: () => 7,
    closeGraceMs: 25,
    openDisposition: "attached",
    settlementScheduler: scheduler.scheduler,
  })
  let settled: RunnerOutcome | undefined
  void handle.waitForOutcome().then((outcome) => {
    settled = outcome
  })
  const emit = (record: unknown): void => port.emitEvent(event(record))
  return {
    handle,
    scheduler,
    emit,
    settled: () => settled,
    setWaits: (next: unknown) => {
      waits = next
    },
    confirm: async () => {
      scheduler.runNext()
      await flushSettlement()
    },
    endTurnWithDetachedCell: async () => {
      emit(lifecycleRecord(DETACHED_CELL_WAITS))
      for (const record of cleanTurnEnd(PROGRESS_NOTE)) emit(record)
      await flushSettlement()
    },
  }
}

describe("createHostSessionHandle pending async work from the engine lifecycle (omo#10487)", () => {
  test("#given the engine reports a detached cell #when the child ends its turn on a progress note #then the task is not completed", async () => {
    // given / when
    const h = harness()
    await h.endTurnWithDetachedCell()

    // then - nothing settled at the turn end, and a confirmation keeps it held
    expect(h.settled()).toBeUndefined()
    await h.confirm()
    expect(h.settled()).toBeUndefined()
    expect(h.scheduler.pending()).toBe(1)
    await h.handle.detach()
  })

  test("#given a held turn #when the cell's completion wakes the child and it answers #then the task completes with that answer, not the progress note", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when - the cell finishes and its notification starts the real final turn
    h.setWaits(undefined)
    h.emit(lifecycleRecord())
    for (const record of wokenTurn(FINAL_RESULT)) h.emit(record)
    await flushSettlement()

    // then - the outcome the parent was already waiting on is the real answer
    expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    await h.handle.detach()
  })

  test("#given a held turn whose work never settles #when the child keeps showing progress #then the bound restarts and the task stays running", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when - twice the bound in confirmations, each after the work changed
    for (let check = 0; check < STALE_CHECKS * 2; check += 1) {
      const waits = { ...DETACHED_CELL_WAITS, background: [{ source: "terminal-background-sessions", activeCount: 1, items: [{ id: `job-${check}` }] }] }
      h.setWaits(waits)
      await h.confirm()
    }

    // then
    expect(h.settled()).toBeUndefined()
    expect(h.scheduler.pending()).toBe(1)
    await h.handle.detach()
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
    await h.handle.detach()
  })
})
