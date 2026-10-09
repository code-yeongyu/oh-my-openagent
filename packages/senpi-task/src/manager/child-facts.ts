import { log } from "@oh-my-opencode/utils"
import { createRunStatsTracker, type RunStatsTracker } from "../run-stats"
import type { ChildExtensionEvent } from "../runners/child-extension-events"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { subscribeEffectiveModel } from "./observed-model"
import { subscribeTranscriptLog } from "./transcript-log"

/** All observations are attached while the manager owns the handle, including its startup relay. */
export function subscribeChildFacts(input: {
  readonly handle: ManagedChildHandle
  readonly taskId: string
  readonly store: TaskRecordStore
  readonly now: () => number
  readonly runStats: Map<string, RunStatsTracker>
  readonly fallbackExhaustions: WeakSet<ManagedChildHandle>
  readonly reopen: () => Promise<void>
  readonly onExtensionEvent: (event: ChildExtensionEvent) => void
}): () => void {
  const { handle, taskId, now, runStats } = input
  const transcript = subscribeTranscriptLog(handle, input.store, taskId)
  runStats.set(taskId, createRunStatsTracker(now(), now))
  const effectiveModel = subscribeEffectiveModel(handle, { store: input.store, taskId, now })
  const stats = handle.subscribe((event) => {
    if (event.type === "retry_fallback_exhausted") input.fallbackExhaustions.add(handle)
    runStats.get(taskId)?.accept(event)
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
    extension?.()
    resumed?.()
  }
}
