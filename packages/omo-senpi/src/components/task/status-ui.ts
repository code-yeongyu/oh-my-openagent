import type { ListScope, ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"

const UI_KEY = "omo-task"
const MAX_WIDGET_ROWS = 5
const DEFAULT_DEBOUNCE_MS = 250
const PROGRESS_HEAD_MAX = 60

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
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
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

function agentLabel(record: TaskRecord): string {
  return record.agent_type ?? record.category ?? "?"
}

function progressHead(record: TaskRecord): string | undefined {
  const text = record.final_response
  if (text === undefined) return undefined
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length <= PROGRESS_HEAD_MAX ? trimmed : `${trimmed.slice(0, PROGRESS_HEAD_MAX)}...`
}

export function formatTaskRow(record: TaskRecord): string {
  const parts = [record.task_id]
  if (record.name !== undefined) parts.push(record.name)
  parts.push(`agent:${agentLabel(record)}`, record.status, `mode:${record.execution_mode}`, `model:${record.model}`)
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
  if (active !== undefined) pieces.push("|", formatTaskRow(active))
  return pieces.join(" ")
}

export function buildWidgetRows(records: readonly TaskRecord[]): string[] {
  const active = records.filter((record) => !isTerminal(record.status))
  if (active.length === 0) return []
  const shown = active.slice(0, MAX_WIDGET_ROWS).map(formatTaskRow)
  const overflow = active.length - MAX_WIDGET_ROWS
  if (overflow > 0) shown.push(`+${overflow} more`)
  return shown
}

const globalTimers: StatusUiTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createTaskStatusUi(deps: TaskStatusUiDeps): TaskStatusUi {
  const timers = deps.timers ?? globalTimers
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  let pending: unknown

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
