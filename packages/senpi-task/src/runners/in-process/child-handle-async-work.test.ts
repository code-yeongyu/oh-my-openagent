import { describe, expect, test } from "bun:test"

import { DETACHED_CELL_WAITS, FINAL_RESULT, PROGRESS_NOTE, lifecycleSnapshot } from "../async-work.test-support"
import { createManualSettlementScheduler, flushSettlement } from "../rpc/turn-settlement.test-support"
import { createChildHandle, type ChildSession, type ChildSessionEvent, type ChildSessionListener, type RunnerOutcome } from "./child-handle"

const INTERVAL_MS = 1_000
const STALE_LIMIT_MS = 5_000
const STALE_CHECKS = 5

function assistantEnd(text: string): ChildSessionEvent & { readonly text: string } {
  return { type: "message_end", text, message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }
}

/**
 * The in-process runner (the `auto` fallback) over a session that behaves like senpi's
 * AgentSession: `prompt()` resolves when the turn ends, `lifecycle` reports the work the session
 * still owns, and that work's completion starts a new engine turn on its own. Before omo#10487 this
 * runner settled every clean turn on `prompt()` resolution and never looked at the lifecycle.
 */
function harness() {
  const scheduler = createManualSettlementScheduler()
  const listeners = new Set<ChildSessionListener>()
  let waits: unknown = DETACHED_CELL_WAITS
  let lastText: string | undefined
  let endPrompt: (() => void) | undefined
  const emit = (event: ChildSessionEvent & { readonly text?: string }): void => {
    if (event.text !== undefined) lastText = event.text
    for (const listener of [...listeners]) listener(event)
  }
  const session: ChildSession = {
    sessionId: "child-10487",
    get lifecycle() {
      return lifecycleSnapshot(waits)
    },
    get isSessionBusy() {
      return waits !== undefined
    },
    prompt: () => new Promise<void>((resolve) => { endPrompt = resolve }),
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
    taskId: "st_10487_inproc",
    session,
    promptText: "run the delayed eval, then answer FINAL-RESULT",
    asyncWork: { schedule: scheduler.scheduler, intervalMs: INTERVAL_MS, staleLimitMs: STALE_LIMIT_MS },
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
    setWaits: (next: unknown) => {
      waits = next
    },
    confirm: async () => {
      scheduler.runNext()
      await flushSettlement()
    },
    endTurnWithDetachedCell: async () => {
      emit(assistantEnd(PROGRESS_NOTE))
      endPrompt?.()
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

    // when - the work drains and the session idles with no engine turn
    h.setWaits(undefined)
    await h.confirm()

    // then
    const outcome = h.settled()
    expect(outcome?.status).toBe("error")
    if (outcome?.status !== "error") throw new Error("expected the typed failure")
    expect(outcome.failure.kind).toBe("async_work_pending")
    expect(outcome.failure.message).toContain("nothing woke the child")
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
})
