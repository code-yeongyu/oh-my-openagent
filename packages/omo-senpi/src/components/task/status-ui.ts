import type { ThemeColor } from "@code-yeongyu/senpi"
import {
  assistantLastLine,
  excerptRendererText,
  formatToolActivity,
  normalizeRendererText,
  rendererVisibleWidth,
  statusThemeColor,
  taskIdentityLabel,
  toolCountSuffix,
  type ListScope,
  type ListedTask,
  type ManagedChildEvent,
  type TaskRecord,
  type TaskRunStats,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

import type { CapturedUi, StatusTheme } from "./runtime-context"

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
// Glyphs follow senpi TUI house style (selectors already use ○/✓/✗/·); all render 1 column wide.
const GLYPH_ACTIVE = "●"
const GLYPH_PENDING = "○"
const GLYPH_DONE = "✓"
const GLYPH_FAIL = "✗"
const SEPARATOR = "·"
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
  theme?: StatusTheme,
): string | undefined {
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
  const activity = liveActivity?.get(active.task_id)
  const row =
    activity === undefined
      ? formatCompactTaskRow(active, rowWidth, { includeName: true, withGlyph: false, paint })
      : formatLiveBackgroundRow(active, activity, now, rowWidth, liveStats?.(active.task_id), paint)
  return compactTokens([
    paint(countColor, glyphPlain),
    paint(countColor, ratioPlain),
    donePlain === undefined ? undefined : paint("success", donePlain),
    errPlain === undefined ? undefined : paint("error", errPlain),
    row,
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
  paint: Painter = paintPlain,
): string {
  const identity = excerptRendererText(
    taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description }),
    stats === undefined ? LIVE_DESCRIPTION_MAX : LIVE_DESCRIPTION_MAX_WITH_STATS,
  )
  const elapsed = formatElapsed(record.created_at, now)
  const frame = SPINNER_FRAMES[Math.floor(now / DEFAULT_DEBOUNCE_MS) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]
  const statsTokens = liveStatsTokens(stats)
  const plain = [frame, identity, ...statsTokens, activity, elapsed].join(" · ").replace(`${frame} · `, `${frame} `)
  if (rendererVisibleWidth(plain) > maxWidth) {
    // Over budget: keep the plain excerpted row so truncation never cuts a painted token.
    return excerptRendererText(plain, maxWidth)
  }
  const statusColor = statusThemeColor(record.status)
  const paintedFrame = paint(statusColor, frame)
  const painted = [paintedFrame, paint("dim", identity), ...statsTokens.map((token) => paint("muted", token)), activity, paint("dim", elapsed)]
  return painted.join(" · ").replace(`${paintedFrame} · `, `${paintedFrame} `)
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
  theme?: StatusTheme,
): string[] {
  const paint = painterOf(theme)
  const active = records.filter((record) => !isTerminal(record.status))
  if (active.length === 0) return []
  const shown = active
    .slice(0, MAX_WIDGET_ROWS)
    .map((record) =>
      formatLiveBackgroundRow(record, activity.get(record.task_id) ?? "running", now, WIDGET_LINE_MAX, liveStats?.(record.task_id), paint),
    )
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
    compactTaskIdentity(record, identityWidth, includeName, paint),
    paint("muted", context),
    paint(statusColor, status),
  ])
}

function compactTaskIdentity(record: TaskRecord, maxWidth: number, includeName: boolean, paint: Painter): string {
  if (!includeName) return paint("dim", excerptRendererText(record.task_id, maxWidth))
  return paint(
    "dim",
    excerptRendererText(
      taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description }),
      maxWidth,
    ),
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
  const now = deps.now ?? Date.now
  const liveActivity = new Map<string, string>()
  const subscriptions = new Map<string, () => void>()
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
    syncChildSubscriptions(records)
    const background = deps.manager.wasBackground === undefined
      ? records
      : records.filter((record) => deps.manager.wasBackground?.(record.task_id) === true)
    const renderedAt = now()
    const liveStats = deps.manager.runStatsSnapshot?.bind(deps.manager)
    const footer = formatFooterStatus(deps.manager.wasBackground === undefined ? records : background, liveActivity, renderedAt, liveStats, ui.theme)
    const rows = deps.manager.wasBackground === undefined
      ? buildWidgetRows(records, ui.theme)
      : backgroundWidgetRows(background, liveActivity, renderedAt, liveStats, ui.theme)
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
