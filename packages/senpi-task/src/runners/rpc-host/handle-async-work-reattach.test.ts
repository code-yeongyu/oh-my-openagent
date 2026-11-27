import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

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
import { harness as processHarness } from "../rpc/handle-async-work.test-support"
import { createManualSettlementScheduler, flushSettlement } from "../rpc/turn-settlement.test-support"
import { createHostSessionHandle } from "./handle"
import { harness as hostHarness } from "./handle-async-work.test-support"
import { FAKE_SESSION, event, fakeSessionPort } from "./handle.test-support"
import type { ReattachOutcomeInfo } from "./handle-reattach"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A transcript whose last answer is the progress note the child ended its turn on. */
function progressNoteTranscript(): string {
  const dir = mkdtempSync(join(tmpdir(), "async-work-reattach-"))
  dirs.push(dir)
  const path = join(dir, "child.jsonl")
  const rows = [
    { type: "message", id: "u1", message: { role: "user", content: "run the delayed eval" } },
    {
      type: "message",
      id: "a1",
      message: { role: "assistant", content: [{ type: "text", text: PROGRESS_NOTE }], stopReason: "stop" },
    },
  ]
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`)
  return path
}

const PENDING_STATE = {
  sessionId: "durable-1",
  isStreaming: false,
  steering: [],
  followUp: [],
  pendingMessageCount: 0,
  lifecycle: lifecycleSnapshot(DETACHED_CELL_WAITS),
}

/** A host-session child held on a detached cell whose connection is then cut and re-joined. */
async function heldThenCut(attached: boolean) {
  const sessionPath = progressNoteTranscript()
  const ports = [fakeSessionPort(), fakeSessionPort()] as const
  const reattached = Promise.withResolvers<ReattachOutcomeInfo>()
  const handle = createHostSessionHandle({
    client: ports[0],
    session: { ...FAKE_SESSION, sessionPath },
    taskId: "st_10487_reattach",
    heartbeatIntervalMs: 600_000,
    now: () => 7,
    closeGraceMs: 25,
    openDisposition: "attached",
    settlementScheduler: createManualSettlementScheduler().scheduler,
    reattach: async () => ({ client: ports[1], session: { ...FAKE_SESSION, sessionPath }, attached }),
    shardEvents: { onReattachOutcome: (info) => reattached.resolve(info) },
  })
  let settled: RunnerOutcome | undefined
  void handle.waitForOutcome().then((outcome) => {
    settled = outcome
  })
  ports[0].emitEvent(event(lifecycleRecord(DETACHED_CELL_WAITS)))
  for (const record of cleanTurnEnd(PROGRESS_NOTE)) ports[0].emitEvent(event(record))
  await flushSettlement()
  expect(settled).toBeUndefined()
  if (attached) void ports[1].stateAsked().then(() => ports[1].answerState(PENDING_STATE))
  ports[0].loseTransport()
  await reattached.promise
  await flushSettlement()
  return { handle, ports, settled: () => settled }
}

/**
 * Review finding 2 on #15137 (omo#10487): re-joining a child must not adopt its progress note as the
 * result while the engine still reports the work that note is waiting on, and a session reopened
 * from its file has lost that work.
 */
describe("re-joining a child whose turn waits on its own async work (omo#10487)", () => {
  test("#given a held turn #when the connection is cut and the live session is re-joined #then the note is not adopted and the wake turn's answer is the result", async () => {
    // given / when
    const h = await heldThenCut(true)

    // then - the live engine still reports the cell: the turn stays held
    expect(h.settled()).toBeUndefined()

    // when - the cell's completion wakes the child on the new connection
    h.ports[1].emitEvent(event(lifecycleRecord()))
    for (const record of wokenTurn(FINAL_RESULT)) h.ports[1].emitEvent(event(record))
    await flushSettlement()

    // then
    expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    await h.handle.dispose()
  })

  test("#given a held turn #when the host reopened the session from its file #then the lost work ends the turn as async_work_pending, with no continuation prompt", async () => {
    // given / when
    const h = await heldThenCut(false)

    // then
    const outcome = h.settled()
    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    expect(h.ports[1].sent.filter((command) => command.type === "prompt")).toEqual([])
    await h.handle.dispose()
  })

  const ADAPTERS = [
    ["the process runner", processHarness],
    ["the shared-host runner", hostHarness],
  ] as const
  for (const [runner, harness] of ADAPTERS) {
    test(`#given ${runner} re-opened over a live session still running a detached cell #when its finished transcript is adopted #then the note is held and the wake turn's answer is the result`, async () => {
      // given - get_state reports an idle session whose lifecycle still names the cell
      const h = harness()

      // when
      await h.handle.adoptFinishedTurn?.(PROGRESS_NOTE, "unrecorded")
      await flushSettlement()

      // then
      expect(h.settled()).toBeUndefined()

      // when
      h.setWaits(undefined)
      h.emit(lifecycleRecord())
      for (const record of wokenTurn(FINAL_RESULT)) h.emit(record)
      await flushSettlement()

      // then
      expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
      await h.handle.dispose()
    })
  }

  test("#given a respawned process child #when its transcript's last answer was held on a pending cell #then adopting it ends the turn as async_work_pending", async () => {
    // given - a new process reopened the session: the cell died with the process that started it
    const h = processHarness()
    const held = { sources: [{ source: "senpi-codemode", activeCount: 1, labels: ["eval cell"] }], children: 0 }

    // when
    await h.handle.adoptFinishedTurn?.(PROGRESS_NOTE, held)
    await flushSettlement()

    // then
    const outcome = h.settled()
    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    await h.handle.dispose()
  })

  test("#given a fresh attached handle #when the transcript records the cell pending after the note but the live engine reports none #then the note is held and then ends as async_work_pending", async () => {
    // given - the durable record names the cell; the re-joined engine reports nothing pending
    const sessionPath = progressNoteTranscript()
    appendFileSync(
      sessionPath,
      `${JSON.stringify({ type: "custom", customType: "session-lifecycle", data: { ...lifecycleSnapshot(DETACHED_CELL_WAITS), sessionId: "durable-1" } })}\n`,
    )
    const port = fakeSessionPort()
    const scheduler = createManualSettlementScheduler()
    const handle = createHostSessionHandle({
      client: { ...port, getState: () => Promise.resolve({ ...PENDING_STATE, lifecycle: lifecycleSnapshot() }) },
      session: { ...FAKE_SESSION, sessionPath },
      taskId: "st_10487_durable",
      heartbeatIntervalMs: 600_000,
      now: () => 7,
      closeGraceMs: 25,
      openDisposition: "attached",
      settlementScheduler: scheduler.scheduler,
    })
    let settled: RunnerOutcome | undefined
    void handle.waitForOutcome().then((outcome) => {
      settled = outcome
    })

    // when
    await handle.reconcileTurn({})
    await flushSettlement()

    // then - held on the recorded work, not adopted as the answer
    expect(settled).toBeUndefined()

    // when - the confirmations read the drained, idle session past the wake-delivery grace
    scheduler.runNext()
    await flushSettlement()
    expect(settled).toBeUndefined()
    scheduler.runNext()
    await flushSettlement()

    // then
    expect(settled?.status).toBe("error")
    if (settled?.status !== "error") throw new Error("expected the typed failure")
    expect(settled.failure.kind).toBe("async_work_pending")
    await handle.dispose()
  })
})
