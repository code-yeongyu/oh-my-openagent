import type { ThemeColor } from "@code-yeongyu/senpi"
import {
  excerptRendererText,
  normalizeRendererText,
  rendererVisibleWidth,
  statusThemeColor,
  type ListScope,
  type ListedTask,
  type TaskRecord,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

import type { CapturedUi, StatusTheme } from "./runtime-context"

const UI_KEY = "omo-task"
const MAX_WIDGET_ROWS = 5
const DEFAULT_DEBOUNCE_MS = 250
const PROGRESS_HEAD_MAX = 60
const STATUS_LINE_MAX = 72
const WIDGET_LINE_MAX = 70
// Glyphs follow senpi TUI house style (selectors already use ○/✓/✗/·); all render 1 column wide.
const GLYPH_ACTIVE = "\u25cf"
const GLYPH_PENDING = "\u25cb"
const GLYPH_DONE = "\u2713"
const GLYPH_FAIL = "\u2717"
const SEPARATOR = "\u00b7"
type TimerHandle = ReturnType<typeof setTimeout> | number

// Paints one token with a theme color; the plain painter (no captured theme) is the identity so
// headless/test paths and width budgeting stay byte-exact ANSI-free.
type Painter = (color: ThemeColor, text: string) => string

const paintPlain: Painter = (_color, text) => text

function painterOf(theme: StatusTheme | undefined): Painter {
  if (theme === undefined) return paintPlain
  return (color, text) => theme.fg(color, text)
}

function statusGlyph(status: TaskStatus): string {
  if (status === "pending") return GLYPH_PENDING
  if (status === "completed") return GLYPH_DONE
  if (TERMINAL_STATUSES.has(status)) return GLYPH_FAIL
  return GLYPH_ACTIVE
}

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

export function formatFooterStatus(records: readonly TaskRecord[], theme?: StatusTheme): string | undefined {
  if (records.length === 0) return undefined
  const paint = painterOf(theme)
  const running = records.filter((record) => record.status === "running").length
  const done = records.filter((record) => isTerminal(record.status)).length
  const errored = records.filter((record) => ERROR_STATUSES.has(record.status)).length
  const active = records.find((record) => !isTerminal(record.status))
  if (active === undefined) {
    // Everything settled: counts are small bounded tokens, well inside STATUS_LINE_MAX.
    return compactTokens([
      errored > 0 ? paint("error", GLYPH_FAIL) : paint("success", GLYPH_DONE),
      paint(errored > 0 ? "muted" : "success", `${done} done`),
      errored > 0 ? paint("dim", SEPARATOR) : undefined,
      errored > 0 ? paint("error", `${errored} err`) : undefined,
    ])
  }
  // Width budgeting happens on plain tokens; painting is applied last and never widens a line.
  const glyphPlain = running > 0 ? GLYPH_ACTIVE : GLYPH_PENDING
  const ratioPlain = `${running}/${records.length}`
  const donePlain = done > 0 ? `${GLYPH_DONE}${done}` : undefined
  const errPlain = errored > 0 ? `${GLYPH_FAIL}${errored}` : undefined
  const prefixWidth = rendererVisibleWidth(compactTokens([glyphPlain, ratioPlain, donePlain, errPlain]))
  const rowWidth = STATUS_LINE_MAX - prefixWidth - 1
  const countColor: ThemeColor = running > 0 ? "accent" : "muted"
  return compactTokens([
    paint(countColor, glyphPlain),
    paint(countColor, ratioPlain),
    donePlain === undefined ? undefined : paint("success", donePlain),
    errPlain === undefined ? undefined : paint("error", errPlain),
    formatCompactTaskRow(active, rowWidth, { includeName: false, withGlyph: false, paint }),
  ])
}

export function buildWidgetRows(records: readonly TaskRecord[], theme?: StatusTheme): string[] {
  const paint = painterOf(theme)
  const active = records.filter((record) => !isTerminal(record.status))
  if (active.length === 0) return []
  const shown = active
    .slice(0, MAX_WIDGET_ROWS)
    .map((record) => formatCompactTaskRow(record, WIDGET_LINE_MAX, { includeName: true, withGlyph: true, paint }))
  const overflow = active.length - MAX_WIDGET_ROWS
  if (overflow > 0) shown.push(paint("dim", `  +${overflow} more`))
  return shown
}

interface CompactRowOptions {
  readonly includeName: boolean
  readonly withGlyph: boolean
  readonly paint: Painter
}

function formatCompactTaskRow(record: TaskRecord, maxWidth: number, options: CompactRowOptions): string {
  const { includeName, withGlyph, paint } = options
  const context = compactTaskContext(record)
  const status = excerptRendererText(record.status, 7)
  const glyphCost = withGlyph ? 2 : 0
  const identityWidth = Math.max(
    0,
    maxWidth - glyphCost - rendererVisibleWidth(context) - rendererVisibleWidth(status) - 2,
  )
  if (identityWidth === 0) return excerptRendererText(`${context} ${status}`, maxWidth)
  const statusColor = statusThemeColor(record.status)
  return compactTokens([
    withGlyph ? paint(statusColor, statusGlyph(record.status)) : undefined,
    ...compactTaskIdentity(record, identityWidth, includeName, paint),
    paint("muted", context),
    paint(statusColor, status),
  ])
}

function compactTaskIdentity(
  record: TaskRecord,
  maxWidth: number,
  includeName: boolean,
  paint: Painter,
): readonly (string | undefined)[] {
  const name = optionalRendererText(record.name)
  if (!includeName || name === undefined || maxWidth <= 5) {
    return [paint("dim", excerptRendererText(record.task_id, maxWidth))]
  }
  const nameWidth = Math.min(9, maxWidth - 5)
  const idWidth = maxWidth - nameWidth - 1
  return [paint("dim", excerptRendererText(record.task_id, idWidth)), excerptRendererText(name, nameWidth)]
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
  ])
}

function compactTokens(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined).join(" ")
}

const globalTimers: StatusUiTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle),
}

// Last payload actually handed to the UI. Skipping identical re-renders keeps the widget's Text
// component caches warm (setWidget rebuilds components) and avoids no-op render requests.
interface RenderedState {
  readonly ui: CapturedUi
  readonly sessionId: string | undefined
  readonly footer: string | undefined
  readonly rowsKey: string | undefined
}

export function createTaskStatusUi(deps: TaskStatusUiDeps): TaskStatusUi {
  const timers = deps.timers ?? globalTimers
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  let pending: TimerHandle | undefined
  let rendered: RenderedState | undefined

  function syncNow(): void {
    const ui = deps.runtime.ui()
    if (ui === undefined) {
      // The captured UI was cleared (switch/shutdown); forget the memo so a recapture re-renders.
      rendered = undefined
      return
    }
    const mode = deps.runtime.mode()
    if (mode !== undefined && mode !== "tui") return
    const sessionId = deps.runtime.sessionId()
    const records = scopedRecords(deps.manager, sessionId)
    const footer = formatFooterStatus(records, ui.theme)
    const rows = buildWidgetRows(records, ui.theme)
    const rowsKey = rows.length === 0 ? undefined : rows.join("\n")
    if (
      rendered !== undefined &&
      rendered.ui === ui &&
      rendered.sessionId === sessionId &&
      rendered.footer === footer &&
      rendered.rowsKey === rowsKey
    ) {
      return
    }
    rendered = { ui, sessionId, footer, rowsKey }
    ui.setStatus(UI_KEY, footer)
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

  function dispose(): void {
    if (pending !== undefined) {
      timers.clear(pending)
      pending = undefined
    }
  }

  return { scheduleSync, syncNow, dispose }
}

function scopedRecords(manager: StatusUiManager, sessionId: string | undefined): readonly TaskRecord[] {
  // Fail-closed: without a session id there is nothing to scope, so the footer/widget stay empty
  // rather than leaking every session's tasks.
  if (sessionId === undefined) return []
  return manager.list({ scope: "parent-session", session_id: sessionId }).map((entry) => entry.record)
}
