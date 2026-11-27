import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import type { AgentSessionEvent, RpcResponse } from "@code-yeongyu/senpi"

import type { RunnerOutcome } from "../in-process/child-handle"
import type { RpcChildHandle } from "../types"
import {
  DETACHED_CELL_WAITS,
  PROGRESS_NOTE,
  cleanTurnEnd,
  lifecycleRecord,
  lifecycleSnapshot,
} from "../async-work.test-support"
import { createChildExtensionEvents } from "../child-extension-events"
import { createRpcChildHandle } from "./handle"
import type { RpcProtocolClient } from "./protocol-client"
import { createManualSettlementScheduler, flushSettlement } from "./turn-settlement.test-support"

// 600 s confirmations against the 60 min default bound: six confirmations without progress.
const HEARTBEAT_MS = 600_000
export const STALE_CHECKS = 6

type Handle = RpcChildHandle & { waitForOutcome(): Promise<RunnerOutcome>; dispose(): Promise<void> }

/**
 * The process runner over a scripted protocol client. The pending work reaches it ONLY as the
 * engine's lifecycle (`session_lifecycle` records and the `get_state` answer), never as a
 * `wake_source_state` extension event: the background-terminal producer publishes on the engine's
 * internal bus alone, which is the gap the earlier wake-source-only hold left open (omo#10487).
 */
export function harness() {
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
              data: {
                sessionId: "s-1",
                isStreaming: false,
                steering: [],
                followUp: [],
                pendingMessageCount: 0,
                lifecycle: lifecycleSnapshot(waits),
              },
            }
          : { success: true }) as unknown as RpcResponse,
      ),
    onEvent: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    detach: () => listeners.clear(),
  } as unknown as RpcProtocolClient
  const child = Object.assign(new EventEmitter(), { pid: 4243 })
  const handle = createRpcChildHandle({
    client,
    child: child as unknown as ChildProcess,
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
    child,
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
