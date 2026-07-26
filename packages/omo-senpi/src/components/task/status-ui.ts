import {
  assistantLastLine,
  excerptRendererText,
  formatToolActivity,
  normalizeRendererText,
  rendererVisibleWidth,
  taskIdentityLabel,
  toolCountSuffix,
  type ListScope,
  type ListedTask,
  type ManagedChildEvent,
  type TaskRecord,
  type TaskRunStats,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"

const UI_KEY = "omo-task"
const MAX_WIDGET_ROWS = 5
const DEFAULT_DEBOUNCE_MS = 250
const PROGRESS_HEAD_MAX = 60
const STATUS_LINE_MAX = 72
const WIDGET_LINE_MAX = 70
const LIVE_DESCRIPTION_MAX = 18
// With turn/tool/tok-s tokens on the row, the identity yields width so the stats stay readable.
const LIVE_DESCRIPTION_MAX_WITH_STATS = 11
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
type TimerHandle = ReturnType<typeof setTimeout> | number

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])
const ERROR_STATUSES: ReadonlySet<TaskStatus> = new Set(["error", "lost"])

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

function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

function optionalRendererText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length === 0 ? undefined : normalized
}

function targetLabel(record: TaskRecord): string {
  const category = optionalRendererText(record.category)
  if (category !== undefined) return `category:${category}`
  return `agent:${optionalRendererText(record.agent_type) ?? "?"}`
}

function modelDisplay(record: TaskRecord): string {
  return optionalRendererText(record.resolved_model?.display) ?? normalizeRendererText(record.model)
}

function progressHead(record: TaskRecord): string | undefined {
  const normalized = optionalRendererText(record.final_response)
  if (normalized === undefined) return undefined
  return excerptRendererText(normalized, PROGRESS_HEAD_MAX)
}

export function formatTaskRow(record: TaskRecord): string {
  const identity = taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description })
  const parts = [identity]
  if (identity !== normalizeRendererText(record.task_id)) parts.push(`(${normalizeRendererText(record.task_id)})`)
  parts.push(targetLabel(record), `model:${modelDisplay(record)}`)
  const reasoning = optionalRendererText(record.resolved_model?.reasoning_effort)
  if (reasoning !== undefined) parts.push(`reasoning:${reasoning}`)
  const variant = optionalRendererText(record.resolved_model?.variant)
  if (variant !== undefined && variant !== reasoning) parts.push(`variant:${variant}`)
  parts.push(`mode:${normalizeRendererText(record.execution_mode)}`, `status:${normalizeRendererText(record.status)}`)
  if (record.pid !== undefined) parts.push(`pid:${record.pid}`)
  const progress = progressHead(record)
  if (progress !== undefined) parts.push(`progress:${progress}`)
  return parts.join(" ")
}

export function formatFooterStatus(
  records: readonly TaskRecord[],
  liveActivity?: ReadonlyMap<string, string>,
  now = Date.now(),
  liveStats?: (taskId: string) => TaskRunStats | undefined,
): string | undefined {
  if (records.length === 0) return undefined
  const running = records.filter((record) => record.status === "running").length
  const done = records.filter((record) => isTerminal(record.status)).length
  const errored = records.filter((record) => ERROR_STATUSES.has(record.status)).length
  const pieces = [`tasks:${records.length}`, `run:${running}`, `done:${done}`, `err:${errored}`]
  const active = records.find((record) => !isTerminal(record.status))
  if (active === undefined) return excerptRendererText(pieces.join(" "), STATUS_LINE_MAX)
  const compactCounts = [`t${records.length}`, `r${running}`]
  if (done > 0) compactCounts.push(`d${done}`)
  if (errored > 0) compactCounts.push(`e${errored}`)
  const prefix = compactCounts.join("/")
  const activity = liveActivity?.get(active.task_id)
  if (activity !== undefined) {
    const rowWidth = STATUS_LINE_MAX - rendererVisibleWidth(prefix) - 1
    return excerptRendererText(`${prefix} ${formatLiveBackgroundRow(active, activity, now, rowWidth, liveStats?.(active.task_id))}`, STATUS_LINE_MAX)
  }
  const rowWidth = STATUS_LINE_MAX - rendererVisibleWidth(prefix) - 1
  return excerptRendererText(`${prefix} ${formatCompactTaskRow(active, rowWidth, true)}`, STATUS_LINE_MAX)
}

export function buildWidgetRows(records: readonly TaskRecord[]): string[] {
  const active = records.filter((record) => !isTerminal(record.status))
  if (active.length === 0) return []
  const shown = active.slice(0, MAX_WIDGET_ROWS).map(formatWidgetRow)
  const overflow = active.length - MAX_WIDGET_ROWS
  if (overflow > 0) shown.push(`+${overflow} more`)
  return shown
}

function formatWidgetRow(record: TaskRecord): string {
  return formatCompactTaskRow(record, WIDGET_LINE_MAX, true)
}

function liveStatsTokens(stats: TaskRunStats | undefined): string[] {
  if (stats === undefined) return []
  const tokens = [`turn ${stats.turns}${toolCountSuffix(stats.tool_calls)}`]
  if (stats.tokens_per_second !== undefined) tokens.push(`${stats.tokens_per_second} tok/s`)
  return tokens
}

function formatLiveBackgroundRow(
  record: TaskRecord,
  activity: string,
  now: number,
  maxWidth = WIDGET_LINE_MAX,
  stats?: TaskRunStats,
): string {
  const identity = excerptRendererText(
    taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description }),
    stats === undefined ? LIVE_DESCRIPTION_MAX : LIVE_DESCRIPTION_MAX_WITH_STATS,
  )
  const elapsed = formatElapsed(record.created_at, now)
  const frame = SPINNER_FRAMES[Math.floor(now / DEFAULT_DEBOUNCE_MS) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]
  const parts = [frame, identity, ...liveStatsTokens(stats), activity, elapsed]
  return excerptRendererText(parts.join(" · ").replace(`${frame} · `, `${frame} `), maxWidth)
}

function formatElapsed(createdAt: string, now: number): string {
  const startedAt = Date.parse(createdAt)
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1_000)) : 0
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`
}

function backgroundWidgetRows(
  records: readonly TaskRecord[],
  activity: ReadonlyMap<string, string>,
  now: number,
  liveStats?: (taskId: string) => TaskRunStats | undefined,
): string[] {
  const active = records.filter((record) => !isTerminal(record.status))
  if (active.length === 0) return []
  const shown = active.slice(0, MAX_WIDGET_ROWS).map((record) =>
    formatLiveBackgroundRow(record, activity.get(record.task_id) ?? "running", now, WIDGET_LINE_MAX, liveStats?.(record.task_id)),
  )
  const overflow = active.length - MAX_WIDGET_ROWS
  if (overflow > 0) shown.push(`+${overflow} more`)
  return shown
}

function formatCompactTaskRow(record: TaskRecord, maxWidth: number, includeName: boolean): string {
  const context = compactTaskContext(record)
  const identityWidth = Math.max(0, maxWidth - rendererVisibleWidth(context) - 1)
  if (identityWidth === 0) return excerptRendererText(context, maxWidth)
  const identity = compactTaskIdentity(record, identityWidth, includeName)
  return excerptRendererText(`${identity}|${context}`, maxWidth)
}

function compactTaskIdentity(record: TaskRecord, maxWidth: number, includeName: boolean): string {
  if (!includeName) return excerptRendererText(record.task_id, maxWidth)
  return excerptRendererText(
    taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description }),
    maxWidth,
  )
}

function compactTaskContext(record: TaskRecord): string {
  const category = optionalRendererText(record.category)
  const target = category === undefined ? `agent:${optionalRendererText(record.agent_type) ?? "?"}` : `category:${category}`
  const reasoning = optionalRendererText(record.resolved_model?.reasoning_effort)
  return compactTokens([
    excerptRendererText(target, 20),
    excerptRendererText(modelDisplay(record), 15),
    reasoning === undefined ? undefined : excerptRendererText(reasoning, 5),
    excerptRendererText(record.execution_mode, 10),
    excerptRendererText(record.status, 7),
  ])
}

function compactTokens(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined).join(" ")
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
