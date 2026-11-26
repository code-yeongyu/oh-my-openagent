import { readLifecyclePendingWork, type PendingAsyncWork, type PendingWorkEvidence } from "../pending-async-work"
import type { TurnWakeSources } from "./turn-wake-sources"

export type TurnAsyncWork = {
  readonly observe: (record: unknown) => void
  readonly observeState: (state: unknown) => void
  readonly pending: () => PendingAsyncWork | undefined
  // What the engine has said about that work: `"unrecorded"` only when it never reported a lifecycle.
  readonly evidence: () => PendingWorkEvidence
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * The child's pending async work as both RPC runners see it (omo#10487). The engine's lifecycle -
 * pushed as `session_lifecycle` records and answered by every `get_state` - is authoritative once
 * observed; an engine that sends neither falls back to the raw `wake_source_state` ledger.
 */
export function createTurnAsyncWork(wakeSources: TurnWakeSources): TurnAsyncWork {
  let lifecycle: PendingAsyncWork | null | undefined
  const take = (value: unknown): void => {
    const read = readLifecyclePendingWork(value)
    if (read !== undefined) lifecycle = read
  }
  return {
    observe: (record) => {
      if (isRecord(record) && record.type === "session_lifecycle") take(record.lifecycle)
    },
    observeState: (state) => {
      if (isRecord(state)) take(state.lifecycle)
    },
    pending: () => (lifecycle === undefined ? wakeSources.pendingAsyncWork() : (lifecycle ?? undefined)),
    evidence: () => {
      const work = lifecycle === undefined ? wakeSources.pendingAsyncWork() : (lifecycle ?? undefined)
      return work ?? (lifecycle === undefined ? "unrecorded" : "none-pending")
    },
  }
}
