import type { RunnerOutcome } from "../in-process/child-handle"
import {
  DETACHED_CELL_WAITS,
  PROGRESS_NOTE,
  cleanTurnEnd,
  lifecycleRecord,
  lifecycleSnapshot,
} from "../async-work.test-support"
import { createManualSettlementScheduler, flushSettlement } from "../rpc/turn-settlement.test-support"
import { createHostSessionHandle } from "./handle"
import type { HostSessionOpenDisposition } from "./handle-port"
import { FAKE_SESSION, event, fakeSessionPort } from "./handle.test-support"

// 600 s confirmations against the 60 min default bound: six confirmations without progress.
const HEARTBEAT_MS = 600_000
export const STALE_CHECKS = 6

/**
 * The shared-host runner over an in-memory session. The pending work reaches it only through the
 * engine's lifecycle: the host's session worker forwards no `wake_source_state` extension event, so
 * the earlier wake-source-only hold never engaged on this path (omo#10487).
 */
export function harness(openDisposition: HostSessionOpenDisposition = "attached") {
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
    openDisposition,
    settlementScheduler: scheduler.scheduler,
  })
  let settled: RunnerOutcome | undefined
  void handle.waitForOutcome().then((outcome) => {
    settled = outcome
  })
  const emit = (record: unknown): void => port.emitEvent(event(record))
  return {
    handle,
    port,
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
