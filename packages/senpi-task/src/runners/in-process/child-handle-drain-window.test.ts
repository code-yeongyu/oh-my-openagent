import { describe, expect, test } from "bun:test"

import { DETACHED_CELL_WAITS, FINAL_RESULT, PROGRESS_NOTE, lifecycleSnapshot } from "../async-work.test-support"
import { createManualSettlementScheduler, flushSettlement } from "../rpc/turn-settlement.test-support"
import {
  createChildHandle,
  type ChildSession,
  type ChildSessionEvent,
  type ChildSessionListener,
  type RunnerOutcome,
} from "./child-handle"

function assistantEnd(text: string): ChildSessionEvent & { readonly text: string } {
  return {
    type: "message_end",
    text,
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  }
}

/** An in-process child whose prompt() resolves only when the test says so, after the turn's events. */
function harness(initialWaits: unknown) {
  const scheduler = createManualSettlementScheduler()
  const listeners = new Set<ChildSessionListener>()
  let waits: unknown = initialWaits
  let lastText: string | undefined
  let endPrompt: (() => void) | undefined
  const emit = (event: ChildSessionEvent & { readonly text?: string }): void => {
    if (event.text !== undefined) lastText = event.text
    for (const listener of [...listeners]) listener(event)
  }
  const session: ChildSession = {
    sessionId: "child-10487-window",
    get lifecycle() {
      return lifecycleSnapshot(waits)
    },
    get isSessionBusy() {
      return waits !== undefined
    },
    prompt: () =>
      new Promise<void>((resolve) => {
        endPrompt = resolve
      }),
    steer: async () => "handled",
    followUp: async () => "handled",
    abort: async () => {},
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText: () => lastText,
    dispose: () => {},
  }
  const handle = createChildHandle({
    taskId: "st_10487_window",
    session,
    promptText: "run the delayed eval, then answer FINAL-RESULT",
    asyncWork: { schedule: scheduler.scheduler, intervalMs: 1_000, staleLimitMs: 5_000 },
  })
  let settled: RunnerOutcome | undefined
  void handle.waitForIdle().then((outcome) => {
    settled = outcome
  })
  return {
    handle,
    scheduler,
    emit,
    settled: () => settled,
    drain: () => {
      waits = undefined
    },
    resolvePrompt: async () => {
      endPrompt?.()
      await flushSettlement()
    },
  }
}

/**
 * Delta review 3 on #15137 (omo#10487), the in-process boundary: the turn's events end before
 * `prompt()` resolves, and the engine can drain a detached cell in between. Work pending at the turn's
 * end is evidence until a new turn supersedes the answer, so a drain in that interval holds the note.
 */
describe("the in-process pending-work window (omo#10487)", () => {
  test("#given a cell pending at the turn's end #when it drains before prompt() resolves #then the note is held and the confirmation reports async_work_pending", async () => {
    // given
    const h = harness(DETACHED_CELL_WAITS)
    h.emit(assistantEnd(PROGRESS_NOTE))
    h.emit({ type: "agent_end" })

    // when
    h.drain()
    await h.resolvePrompt()

    // then - not the note; the hold's confirmation reads the drained, idle session
    expect(h.settled()).toBeUndefined()
    h.scheduler.runNext()
    await flushSettlement()
    const outcome = h.settled()
    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    expect(outcome.failure.message).toContain("senpi-codemode: 1 [eval cell]")
    await h.handle.dispose()
  })

  test("#given a cell pending at the turn's end #when it drains and a new engine turn answers with nothing pending #then that answer completes", async () => {
    // given
    const h = harness(DETACHED_CELL_WAITS)
    h.emit(assistantEnd(PROGRESS_NOTE))
    h.emit({ type: "agent_end" })
    h.drain()
    await h.resolvePrompt()

    // when
    h.emit({ type: "agent_start" })
    h.emit(assistantEnd(FINAL_RESULT))
    h.emit({ type: "agent_end" })
    await flushSettlement()

    // then
    expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    await h.handle.dispose()
  })

  test("#given no work at any point #when the turn ends and prompt() resolves #then it completes at once, with no confirmation armed", async () => {
    // given
    const h = harness(undefined)
    h.emit(assistantEnd(FINAL_RESULT))
    h.emit({ type: "agent_end" })

    // when
    await h.resolvePrompt()

    // then
    expect(h.settled()).toEqual({ status: "completed", finalResponse: FINAL_RESULT })
    expect(h.scheduler.pending()).toBe(0)
    await h.handle.dispose()
  })
})
