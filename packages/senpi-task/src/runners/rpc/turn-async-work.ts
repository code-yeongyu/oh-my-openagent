import { readLifecyclePendingWork, type PendingAsyncWork, type PendingWorkEvidence } from "../pending-async-work"
import type { TurnWakeSources } from "./turn-wake-sources"

export type TurnAsyncWork = {
  readonly observe: (record: unknown) => void
  readonly observeState: (state: unknown) => void
  // The current snapshot: what an armed hold re-reads to see the work drain.
  readonly pending: () => PendingAsyncWork | undefined
  // The work the current answer was given against (the window below), for every decision that
  // classifies that answer: holding it at idle, ending it at an exit, a park or a teardown.
  readonly answerWork: () => PendingAsyncWork | undefined
  // `answerWork` as explicit evidence: `"unrecorded"` only when the engine never reported a lifecycle.
  readonly evidence: () => PendingWorkEvidence
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * The child's pending async work as both RPC runners see it (omo#10487). The engine's lifecycle -
 * pushed as `session_lifecycle` records and answered by every `get_state` - is authoritative once
 * observed; an engine that sends neither falls back to the raw `wake_source_state` ledger.
 *
 * Evidence has a window: from the turn's end (`agent_end`) until a new `agent_start` supersedes the
 * answer. Work pending at that end, or seen pending any time after it, makes the answer a held note;
 * a later zero snapshot never clears that, and work that started and drained before the end is not
 * evidence. So it makes no difference whether the work drains just before or just after agent_idle.
 */
export function createTurnAsyncWork(wakeSources: TurnWakeSources): TurnAsyncWork {
  let lifecycle: PendingAsyncWork | null | undefined
  let answerWindow = false
  let latched: PendingAsyncWork | undefined
  const current = (): PendingAsyncWork | undefined =>
    lifecycle === undefined ? wakeSources.pendingAsyncWork() : (lifecycle ?? undefined)
  const note = (): void => {
    const work = current()
    if (answerWindow && work !== undefined) latched = work
  }
  const take = (value: unknown): void => {
    const read = readLifecyclePendingWork(value)
    if (read !== undefined) lifecycle = read
    note()
  }
  const answerWork = (): PendingAsyncWork | undefined => (answerWindow ? (current() ?? latched) : current())
  return {
    observe: (record) => {
      if (!isRecord(record)) return
      if (record.type === "session_lifecycle") return take(record.lifecycle)
      if (record.type === "agent_start") {
        answerWindow = false
        latched = undefined
        return
      }
      if (record.type === "agent_end" && record.willRetry === false) {
        answerWindow = true
        latched = current()
        return
      }
      note()
    },
    observeState: (state) => {
      if (isRecord(state)) take(state.lifecycle)
    },
    pending: current,
    answerWork,
    evidence: () => answerWork() ?? (lifecycle === undefined ? "unrecorded" : "none-pending"),
  }
}
