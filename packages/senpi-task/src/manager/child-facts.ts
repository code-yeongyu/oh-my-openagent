import { log } from "@oh-my-opencode/utils"
import { createRunStatsTracker, type RunStatsTracker } from "../run-stats"
import type { ChildExtensionEvent } from "../runners/child-extension-events"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { subscribeEffectiveModel } from "./observed-model"
import { subscribeTranscriptLog } from "./transcript-log"

const MOTION_EVENTS: ReadonlySet<string> = new Set(["agent_start", "turn_start", "tool_execution_start"])

/** All observations are attached while the manager owns the handle, including its startup relay. */
export function subscribeChildFacts(input: {
  readonly handle: ManagedChildHandle
  readonly taskId: string
  readonly store: TaskRecordStore
  readonly now: () => number
  readonly runStats: Map<string, RunStatsTracker>
  readonly fallbackExhaustions: WeakSet<ManagedChildHandle>
  readonly reopen: () => Promise<void>
  // The child demonstrably moved (a run, turn or tool started): a "resumed, waiting for input"
  // flag stamped before it no longer holds (senpi#3266).
  readonly onMotion?: () => void
  readonly onExtensionEvent: (event: ChildExtensionEvent) => void
}): () => void {
  const { handle, taskId, now, runStats } = input
  const transcript = subscribeTranscriptLog(handle, input.store, taskId)
  runStats.set(taskId, createRunStatsTracker(now(), now))
  const effectiveModel = subscribeEffectiveModel(handle, { store: input.store, taskId, now })
  const stats = handle.subscribe((event) => {
    if (event.type === "retry_fallback_exhausted") input.fallbackExhaustions.add(handle)
    if (MOTION_EVENTS.has(event.type)) input.onMotion?.()
    runStats.get(taskId)?.accept(event)
  })
  const reconciled = handle.onReconciled?.((notice) => {
    const timestamp = new Date(now()).toISOString()
    if (notice.kind === "adopted") {
      input.store.mutate(taskId, (fresh) => ({
        ...fresh,
        ...(fresh.host_session === undefined ? {} : { host_session: { ...fresh.host_session, adopted_entry_id: notice.entryId } }),
      }))
    } else {
      const action = notice.kind === "interrupted" ? notice.action : undefined
      const needsAction = notice.kind === "idle_queued" || notice.deadline !== undefined || action !== undefined
      const reason = action === undefined ? notice.reason : `${notice.reason} Action: ${action}`
      input.store.transition(taskId, { type: "interrupt", timestamp, ...(needsAction ? { error_message: reason } : {}) })
      if (notice.kind === "interrupted" && notice.deadline !== undefined) {
        input.store.mutate(taskId, (fresh) => ({ ...fresh, stop_reason: "deadline", deadline: notice.deadline }))
      }
    }
    input.store.appendEvent(taskId, { type: notice.kind === "idle_queued" ? "idle_queued" : "host_turn_reconciled", payload: notice })
  })
  const extension = handle.subscribeExtensionEvents?.(input.onExtensionEvent)
  const resumed = handle.onSelfResumed?.(() => {
    runStats.set(taskId, createRunStatsTracker(now(), now))
    void input.reopen().catch((error: unknown) =>
      log("senpi-task self-resumed turn reopen failed", { taskId, error: String(error) }))
  })
  return () => {
    transcript()
    effectiveModel()
    stats()
    reconciled?.()
    extension?.()
    resumed?.()
  }
}
