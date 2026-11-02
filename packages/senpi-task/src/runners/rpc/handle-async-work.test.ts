import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import type { AgentSessionEvent, RpcResponse } from "@code-yeongyu/senpi"
import { describe, expect, test } from "bun:test"

import type { RunnerOutcome } from "../in-process/child-handle"
import type { RpcChildHandle } from "../types"
import {
  DETACHED_CELL_WAITS,
  FINAL_RESULT,
  PROGRESS_NOTE,
  cleanTurnEnd,
  lifecycleRecord,
  lifecycleSnapshot,
  wokenTurn,
} from "../async-work.test-support"
import { createChildExtensionEvents } from "../child-extension-events"
import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"
import { createManualSettlementScheduler, flushSettlement } from "./turn-settlement.test-support"

// 600 s confirmations against the 60 min default bound: six confirmations without progress.
const HEARTBEAT_MS = 600_000
const STALE_CHECKS = 6

type Handle = RpcChildHandle & { waitForOutcome(): Promise<RunnerOutcome>; dispose(): Promise<void> }

/**
 * The process runner over a scripted protocol client. The pending work reaches it ONLY as the
 * engine's lifecycle (`session_lifecycle` records and the `get_state` answer), never as a
 * `wake_source_state` extension event: the background-terminal producer publishes on the engine's
 * internal bus alone, which is the gap the earlier wake-source-only hold left open (omo#10487).
 */
function harness() {
  const scheduler = createManualSettlementScheduler()
  const listeners = new Set<(event: AgentSessionEvent) => void>()
  let waits: unknown = DETACHED_CELL_WAITS
  const client = {
    extensionEvents: createChildExtensionEvents(),
    stderrTail: "",
    send: (command: { readonly type?: string }) =>
      Promise.resolve(
        (command.type === "get_state"
          ? {
              success: true,
              command: "get_state",
              data: { sessionId: "s-1", isStreaming: false, steering: [], followUp: [], pendingMessageCount: 0, lifecycle: lifecycleSnapshot(waits) },
            }
          : { success: true }) as unknown as RpcResponse,
      ),
    onEvent: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    detach: () => listeners.clear(),
  } as unknown as RpcProtocolClient
  const handle = createRpcChildHandle({
    client,
    child: Object.assign(new EventEmitter(), { pid: 4243 }) as unknown as ChildProcess,
    taskId: "st_10487_rpc",
    heartbeatIntervalMs: HEARTBEAT_MS,
    now: () => 1,
    settlementScheduler: scheduler.scheduler,
  }) as Handle
  let settled: RunnerOutcome | undefined
  void handle.waitForOutcome().then((outcome) => {
    settled = outcome
  })
  const emit = (record: unknown): void => {
    for (const listener of listeners) listener(record as AgentSessionEvent)
  }
  const confirm = async (): Promise<void> => {
    scheduler.runNext()
    await flushSettlement()
  }
  return {
    handle,
    scheduler,
    emit,
    confirm,
    settled: () => settled,
    setWaits: (next: unknown) => {
      waits = next
    },
    endTurnWithDetachedCell: async () => {
      emit(lifecycleRecord(DETACHED_CELL_WAITS))
      for (const record of cleanTurnEnd(PROGRESS_NOTE)) emit(record)
      await flushSettlement()
    },
  }
}

describe("createRpcChildHandle pending async work from the engine lifecycle (omo#10487)", () => {
  test("#given the engine reports a detached cell #when the child ends its turn on a progress note #then the task is not completed", async () => {
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
    await h.handle.dispose()
  })

  test("#given a held turn whose work never settles #when the child keeps showing progress #then the bound restarts and the task stays running", async () => {
    // given
    const h = harness()
    await h.endTurnWithDetachedCell()

    // when - twice the bound in confirmations, each preceded by observable activity
    for (let check = 0; check < STALE_CHECKS * 2; check += 1) {
      h.emit({ type: "extension_event", name: "terminal_background_output", data: { id: "job-1" } })
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
