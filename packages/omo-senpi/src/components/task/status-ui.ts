import {
  assistantLastLine,
  excerptRendererText,
  formatToolActivity,
  type ListScope,
  type ListedTask,
  type ManagedChildEvent,
  type TaskRecord,
  type TaskRunStats,
} from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import { backgroundWidgetRows, buildWidgetRows, formatFooterStatus, isTerminal } from "./status-row-format"

export { buildWidgetRows, formatFooterStatus, formatTaskRow } from "./status-row-format"

const UI_KEY = "omo-task"
const DEFAULT_DEBOUNCE_MS = 250
type TimerHandle = ReturnType<typeof setTimeout> | number

// The manager read-seam the footer/widget need: a session-scoped task list. Matches TaskManager.list.
export interface StatusUiManager {
  list(scope: ListScope): readonly ListedTask[]
  // The public live-handle seam. Optional preserves the narrow list-only seam used by legacy tests.
  wasBackground?(taskId: string): boolean
  subscribeChild?(taskId: string, listener: (event: ManagedChildEvent) => void): () => void
  // In-flight turns/tools/tok-s for a live child; absent rows simply omit the stats tokens.
  runStatsSnapshot?(taskId: string): TaskRunStats | undefined
}

// The captured-UI facts the sync reads: the live ui handle (undefined when none is captured, so every
// call no-ops), the scoping session id, and the run mode (UI is skipped outside "tui").
export interface StatusUiRuntime {
  ui(): CapturedUi | undefined
  sessionId(): string | undefined
  mode(): string | undefined
}

// Injectable timer seam so the 250ms debounce is deterministic under test; defaults to global timers.
export interface StatusUiTimers {
  set(callback: () => void, ms: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface TaskStatusUiDeps {
  readonly manager: StatusUiManager
  readonly runtime: StatusUiRuntime
  readonly debounceMs?: number
  readonly timers?: StatusUiTimers
  // Local rendering time only: no timer emits updates merely to advance elapsed or spinner frames.
  readonly now?: () => number
}

export interface TaskStatusUi {
  // Debounced refresh, driven by store transitions; coalesces a burst into one render.
  scheduleSync(): void
  // Immediate render (used on session/model events and internally by the debounce timer).
  syncNow(): void
  // Cancel any pending debounce timer so shutdown does not leave a render scheduled past teardown.
  dispose(): void
}

const globalTimers: StatusUiTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle),
}

export function createTaskStatusUi(deps: TaskStatusUiDeps): TaskStatusUi {
  const timers = deps.timers ?? globalTimers
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const now = deps.now ?? Date.now
  const liveActivity = new Map<string, string>()
  const subscriptions = new Map<string, () => void>()
  let pending: TimerHandle | undefined

  function syncNow(): void {
    const ui = deps.runtime.ui()
    if (ui === undefined) return
    const mode = deps.runtime.mode()
    if (mode !== undefined && mode !== "tui") return
    const sessionId = deps.runtime.sessionId()
    const records = scopedRecords(deps.manager, sessionId)
    syncChildSubscriptions(records)
    const background = deps.manager.wasBackground === undefined
      ? records
      : records.filter((record) => deps.manager.wasBackground?.(record.task_id) === true)
    const renderedAt = now()
    const liveStats = deps.manager.runStatsSnapshot?.bind(deps.manager)
    const footer = formatFooterStatus(deps.manager.wasBackground === undefined ? records : background, liveActivity, renderedAt, liveStats)
    ui.setStatus(UI_KEY, footer)
    const rows = deps.manager.wasBackground === undefined
      ? buildWidgetRows(records)
      : backgroundWidgetRows(background, liveActivity, renderedAt, liveStats)
    if (rows.length === 0) {
      ui.setWidget(UI_KEY, undefined)
      return
    }
    ui.setWidget(UI_KEY, rows, { placement: "belowEditor" })
  }

  function scheduleSync(): void {
    // Store mutations happen synchronously before TaskManager starts the child. Attach here rather
    // than waiting for the debounced paint, otherwise a fast first tool_execution_start is lost.
    if (deps.runtime.ui() !== undefined) {
      const mode = deps.runtime.mode()
      if (mode === undefined || mode === "tui") {
        syncChildSubscriptions(scopedRecords(deps.manager, deps.runtime.sessionId()))
      }
    }
    if (pending !== undefined) timers.clear(pending)
    pending = timers.set(() => {
      pending = undefined
      syncNow()
    }, debounceMs)
  }

  function syncChildSubscriptions(records: readonly TaskRecord[]): void {
    if (deps.manager.subscribeChild === undefined || deps.manager.wasBackground === undefined) return
    const activeBackgroundIds = new Set(
      records
        .filter((record) => !isTerminal(record.status) && deps.manager.wasBackground?.(record.task_id) === true)
        .map((record) => record.task_id),
    )
    for (const [taskId, unsubscribe] of subscriptions) {
      if (activeBackgroundIds.has(taskId)) continue
      unsubscribe()
      subscriptions.delete(taskId)
      liveActivity.delete(taskId)
    }
    for (const taskId of activeBackgroundIds) {
      if (subscriptions.has(taskId)) continue
      subscriptions.set(taskId, deps.manager.subscribeChild(taskId, (event) => {
        const activity = activityFromEvent(event)
        if (activity === undefined) return
        liveActivity.set(taskId, activity)
        scheduleSync()
      }))
    }
  }

  function dispose(): void {
    if (pending !== undefined) {
      timers.clear(pending)
      pending = undefined
    }
    for (const unsubscribe of subscriptions.values()) unsubscribe()
    subscriptions.clear()
    liveActivity.clear()
  }

  return { scheduleSync, syncNow, dispose }
}

function activityFromEvent(event: ManagedChildEvent): string | undefined {
  if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
    return excerptRendererText(formatToolActivity(event.toolName, event.args ?? event.input), 32)
  }
  if (event.type === "tool_execution_end") return "running"
  if (event.type === "message_end") {
    const line = assistantLastLine(event.message)
    return line === undefined ? undefined : excerptRendererText(line, 32)
  }
  return undefined
}

function scopedRecords(manager: StatusUiManager, sessionId: string | undefined): readonly TaskRecord[] {
  // Fail-closed: without a session id there is nothing to scope, so the footer/widget stay empty
  // rather than leaking every session's tasks.
  if (sessionId === undefined) return []
  return manager.list({ scope: "parent-session", session_id: sessionId }).map((entry) => entry.record)
}
