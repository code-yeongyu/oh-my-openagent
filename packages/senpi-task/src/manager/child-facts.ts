import { log } from "@oh-my-opencode/utils"
import { createRunStatsTracker, type RunStatsTracker } from "../run-stats"
import type { ChildExtensionEvent } from "../runners/child-extension-events"
import { currentRunStartEpoch, nextRunEpoch, type TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { subscribeEffectiveModel } from "./observed-model"
import { observeParentModelFallback, type FailedTurn } from "./parent-model-fallback"
import { subscribeTranscriptLog } from "./transcript-log"
import type { HostLivenessStatus } from "../runners/rpc-host/handle-heartbeat"

const MOTION_EVENTS: ReadonlySet<string> = new Set(["agent_start", "turn_start", "tool_execution_start"])
const LIVENESS_NOTICE_DEBOUNCE_MS = 30_000

/** All observations are attached while the manager owns the handle, including its startup relay. */
export function subscribeChildFacts(input: {
  readonly handle: ManagedChildHandle
  readonly taskId: string
  readonly store: TaskRecordStore
  readonly now: () => number
  readonly runStats: Map<string, RunStatsTracker>
  readonly fallbackExhaustions: WeakSet<ManagedChildHandle>
  readonly failedTurns: WeakMap<ManagedChildHandle, FailedTurn>
  readonly reopen: () => Promise<void>
  // The child demonstrably moved (a run, turn or tool started): a "resumed, waiting for input"
  // flag stamped before it no longer holds (senpi#3266).
  readonly onMotion?: () => void
  readonly onExtensionEvent: (event: ChildExtensionEvent) => void
  readonly onLiveness: (status: HostLivenessStatus) => void
  readonly onLivenessNotice: (record: TaskRecord, status: HostLivenessStatus) => void
}): () => void {
  const { handle, taskId, now, runStats } = input
  const transcript = subscribeTranscriptLog(handle, input.store, taskId)
  runStats.set(taskId, createRunStatsTracker(now(), now, currentRunStartEpoch(input.store.load(taskId))))
  const effectiveModel = subscribeEffectiveModel(handle, { store: input.store, taskId, now })
  const parentFallback = observeParentModelFallback({ handle, store: input.store, taskId, now, failedTurns: input.failedTurns })
  const stats = handle.subscribe((event) => {
    if (event.type === "retry_fallback_exhausted") input.fallbackExhaustions.add(handle)
    parentFallback(event)
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
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let noticedState: HostLivenessStatus["state"] = "running"
  const liveness = handle.onLiveness?.((status) => {
    const record = input.store.load(taskId)
    if (record === null || record.residency_state !== "resident") return
    input.store.appendEvent(taskId, { type: "host_liveness", payload: status })
    input.onLiveness(status)
    clearTimeout(noticeTimer)
    if (status.state === noticedState) return
    const notify = (): void => {
      const current = input.store.load(taskId)
      if (current === null || current.residency_state !== "resident") return
      try {
        input.onLivenessNotice(current, status)
        noticedState = status.state
      } catch (error) {
        log("senpi-task host liveness notice failed", { taskId, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (status.state === "terminal-pending") notify()
    else {
      noticeTimer = setTimeout(notify, LIVENESS_NOTICE_DEBOUNCE_MS)
      noticeTimer.unref?.()
    }
  })
  const resumed = handle.onSelfResumed?.(() => {
    // The resumed turn is the run the reopen is about to start (buildRevived's nextRunEpoch).
    const fresh = input.store.load(taskId)
    runStats.set(taskId, createRunStatsTracker(now(), now, fresh === null ? undefined : nextRunEpoch(fresh)))
    void input.reopen().catch((error: unknown) =>
      log("senpi-task self-resumed turn reopen failed", { taskId, error: String(error) }))
  })
  return () => {
    transcript()
    effectiveModel()
    stats()
    reconciled?.()
    extension?.()
    liveness?.()
    clearTimeout(noticeTimer)
    resumed?.()
  }
}
