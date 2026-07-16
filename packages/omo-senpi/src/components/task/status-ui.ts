import {
  excerptRendererText,
  normalizeRendererText,
  rendererVisibleWidth,
  type ListScope,
  type ListedTask,
  type TaskRecord,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"

const UI_KEY = "omo-task"
const MAX_WIDGET_ROWS = 5
const DEFAULT_DEBOUNCE_MS = 250
const PROGRESS_HEAD_MAX = 60
const STATUS_LINE_MAX = 72
const WIDGET_LINE_MAX = 70
type TimerHandle = ReturnType<typeof setTimeout> | number

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])
const ERROR_STATUSES: ReadonlySet<TaskStatus> = new Set(["error", "lost"])

// The manager read-seam the footer/widget need: a session-scoped task list. Matches TaskManager.list.
export interface StatusUiManager {
  list(scope: ListScope): readonly ListedTask[]
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
}

export interface TaskStatusUi {
  // Debounced refresh, driven by store transitions; coalesces a burst into one render.
  scheduleSync(): void
  // Immediate render (used on session/model events and internally by the debounce timer).
  syncNow(): void
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
  const parts = [normalizeRendererText(record.task_id)]
  const name = optionalRendererText(record.name)
  if (name !== undefined) parts.push(name)
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

export function formatFooterStatus(records: readonly TaskRecord[]): string | undefined {
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
  const rowWidth = STATUS_LINE_MAX - rendererVisibleWidth(prefix) - 1
  return excerptRendererText(`${prefix} ${formatCompactTaskRow(active, rowWidth, false)}`, STATUS_LINE_MAX)
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

function formatCompactTaskRow(record: TaskRecord, maxWidth: number, includeName: boolean): string {
  const context = compactTaskContext(record)
  const identityWidth = Math.max(0, maxWidth - rendererVisibleWidth(context) - 1)
  if (identityWidth === 0) return excerptRendererText(context, maxWidth)
  const identity = compactTaskIdentity(record, identityWidth, includeName)
  return excerptRendererText(`${identity}|${context}`, maxWidth)
}

function compactTaskIdentity(record: TaskRecord, maxWidth: number, includeName: boolean): string {
  const name = optionalRendererText(record.name)
  if (!includeName || name === undefined || maxWidth <= 5) return excerptRendererText(record.task_id, maxWidth)
  const nameWidth = Math.min(9, maxWidth - 5)
  const idWidth = maxWidth - nameWidth - 1
  return compactTokens([
    excerptRendererText(record.task_id, idWidth),
    excerptRendererText(name, nameWidth),
  ])
}

function compactTaskContext(record: TaskRecord): string {
  const category = optionalRendererText(record.category)
  const target = category === undefined ? `a:${optionalRendererText(record.agent_type) ?? "?"}` : `c:${category}`
  const reasoning = optionalRendererText(record.resolved_model?.reasoning_effort)
  return compactTokens([
    excerptRendererText(target, 12),
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
  let pending: TimerHandle | undefined

  function syncNow(): void {
    const ui = deps.runtime.ui()
    if (ui === undefined) return
    const mode = deps.runtime.mode()
    if (mode !== undefined && mode !== "tui") return
    const sessionId = deps.runtime.sessionId()
    const records = scopedRecords(deps.manager, sessionId)
    const footer = formatFooterStatus(records)
    ui.setStatus(UI_KEY, footer)
    const rows = buildWidgetRows(records)
    if (rows.length === 0) {
      ui.setWidget(UI_KEY, undefined)
      return
    }
    ui.setWidget(UI_KEY, rows, { placement: "belowEditor" })
  }

  function scheduleSync(): void {
    if (pending !== undefined) timers.clear(pending)
    pending = timers.set(() => {
      pending = undefined
      syncNow()
    }, debounceMs)
  }

  return { scheduleSync, syncNow }
}

function scopedRecords(manager: StatusUiManager, sessionId: string | undefined): readonly TaskRecord[] {
  // Fail-closed: without a session id there is nothing to scope, so the footer/widget stay empty
  // rather than leaking every session's tasks.
  if (sessionId === undefined) return []
  return manager.list({ scope: "parent-session", session_id: sessionId }).map((entry) => entry.record)
}
