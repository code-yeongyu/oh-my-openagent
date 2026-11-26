import { describe, expect, test } from "bun:test"

import { DETACHED_CELL_WAITS, FINAL_RESULT, PROGRESS_NOTE, lifecycleSnapshot } from "../async-work.test-support"
import { createManualSettlementScheduler, flushSettlement } from "../rpc/turn-settlement.test-support"
import { createStagedChildHandle, type ChildSession, type ChildSessionEvent, type RunnerOutcome } from "./child-handle"

function assistantEnd(text: string): ChildSessionEvent & { readonly text: string } {
  return {
    type: "message_end",
    text,
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  }
}

/** A staged child the engine itself starts on its run's Resume (senpi#3811), with a detached cell. */
function resumableChild() {
  const listeners = new Set<(event: ChildSessionEvent) => void>()
  let waits: unknown = DETACHED_CELL_WAITS
  let lastText: string | undefined
  const emit = (event: ChildSessionEvent & { readonly text?: string }): void => {
    if (event.text !== undefined) lastText = event.text
    for (const listener of [...listeners]) listener(event)
  }
  const session: ChildSession = {
    sessionId: "child-10487-resume",
    get lifecycle() {
      return lifecycleSnapshot(waits)
    },
    get isSessionBusy() {
      return waits !== undefined
    },
    prompt: () => Promise.resolve(),
    steer: async () => "handled",
    followUp: async () => "handled",
    abort: async () => {},
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText: () => lastText,
    dispose: () => {},
    pauseForRun: () => Promise.reject(new Error("unused")),
    resumeForRun: () => Promise.resolve({ released: true, otherHoldLive: false, turnId: "turn-resumed" }),
    holdInput: () => {
      throw new Error("unused")
    },
    pauseView: { pauseSeq: 1, records: [] },
  }
  const scheduler = createManualSettlementScheduler()
  const staged = createStagedChildHandle({
    taskId: "st_10487_resume",
    session,
    promptText: "run the delayed eval, then answer FINAL-RESULT",
    asyncWork: { schedule: scheduler.scheduler, intervalMs: 1_000, staleLimitMs: 5_000 },
  })
  return {
    handle: staged.handle,
    scheduler,
    emit,
    setWaits: (next: unknown) => {
      waits = next
    },
  }
}

/**
 * Review finding 4 on #15137 (omo#10487): a turn the engine starts on Resume ends through the same
 * async-work hold as a prompted turn, so a resumed DAG child that ends on a progress note while its
 * detached cell runs does not complete its resumed run with that note.
 */
describe("an in-process child resumed by its run (omo#10487)", () => {
  test("#given a resumed turn that ends on a progress note with a cell pending #when the cell's completion wakes it #then the resumed run's outcome is the wake turn's answer", async () => {
    // given
    const c = resumableChild()
    const runPause = c.handle.runPause
    if (runPause === undefined) throw new Error("expected native run pause")
    const resumed = await runPause.resumeForRun({
      parentSessionId: "parent",
      parentPauseSeq: 1,
      resumeId: "resume-1",
      childSeqCutoff: 1,
    })
    if (!resumed.released || !("outcome" in resumed) || resumed.outcome === undefined)
      throw new Error("expected a resumed turn")
    let settled: RunnerOutcome | undefined
    void resumed.outcome.then((outcome) => {
      settled = outcome
    })

    // when - the engine runs the resumed turn, which ends on a note while the cell is detached
    c.emit({ type: "agent_start" })
    c.emit(assistantEnd(PROGRESS_NOTE))
    c.emit({ type: "agent_end" })
    await flushSettlement()

    // then - held, not completed with the note
    expect(settled).toBeUndefined()
    expect(c.scheduler.pending()).toBe(1)

    // when - the cell finishes and its notification starts the turn that answers
    c.setWaits(undefined)
    c.emit({ type: "agent_start" })
    c.emit(assistantEnd(FINAL_RESULT))
    c.emit({ type: "agent_end" })
    await flushSettlement()

    // then
    expect(settled).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    expect(await c.handle.waitForIdle()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    await c.handle.dispose()
  })
})
