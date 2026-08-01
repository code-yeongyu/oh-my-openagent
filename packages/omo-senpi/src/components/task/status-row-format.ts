import {
  excerptRendererText,
  formatSpend,
  formatStatusTarget,
  formatTargetWithModel,
  normalizeRendererText,
  rendererVisibleWidth,
  taskIdentityLabel,
  toolCountSuffix,
  type TaskRecord,
  type TaskRunStats,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

const MAX_WIDGET_ROWS = 5
const WIDGET_LINE_MAX = 70
const LIVE_WIDGET_LINE_MAX = 120
const PROGRESS_HEAD_MAX = 60
const LIVE_DESCRIPTION_MAX = 18
const LIVE_DESCRIPTION_MAX_WITH_STATS = 11
export const LIVE_STATUS_REFRESH_MS = 250
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

function optionalRendererText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length === 0 ? undefined : normalized
}

// One target for every row shape: the shared status-line grammar (`category:<n>(<model>:<effort>)`
// | `agent:<n>(<model>:<effort>)`), so agent-routed rows read exactly like category-routed rows.
function recordStatusTarget(record: TaskRecord): string {
  return formatStatusTarget({
    category: record.category,
    agentType: record.agent_type,
    resolvedModel: record.resolved_model,
    model: record.model,
    fallbackCount: record.fallback_attempts?.length,
  }) ?? "task"
}

function progressHead(record: TaskRecord): string | undefined {
  const normalized = optionalRendererText(record.final_response)
  if (normalized === undefined) return undefined
  return excerptRendererText(normalized, PROGRESS_HEAD_MAX)
}

export function formatTaskRow(record: TaskRecord): string {
  const identity = taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description, taskSummary: record.task_summary })
  const parts = [identity]
  if (identity !== normalizeRendererText(record.task_id)) parts.push(`(${normalizeRendererText(record.task_id)})`)
  parts.push(recordStatusTarget(record))
  parts.push(`mode:${normalizeRendererText(record.execution_mode)}`, `status:${normalizeRendererText(record.status)}`)
  if (record.pid !== undefined) parts.push(`pid:${record.pid}`)
  const progress = progressHead(record)
  if (progress !== undefined) parts.push(`progress:${progress}`)
  return parts.join(" ")
}

export function buildWidgetRows(records: readonly TaskRecord[]): string[] {
  const active = records.filter((record) => !isTerminal(record.status))
  if (active.length === 0) return []
  const shown = active.slice(0, MAX_WIDGET_ROWS).map((record) => formatCompactTaskRow(record, WIDGET_LINE_MAX, true))
  const overflow = active.length - MAX_WIDGET_ROWS
  if (overflow > 0) shown.push(`+${overflow} more`)
  return shown
}

function liveStatsTokens(stats: TaskRunStats | undefined): string[] {
  if (stats === undefined) return []
  const tokens = [`turn ${stats.turns}${toolCountSuffix(stats.tool_calls)}`]
  const spend = formatSpend(stats)
  if (spend !== undefined) tokens.push(spend)
  if (stats.tokens_per_second !== undefined) tokens.push(`${stats.tokens_per_second} tok/s`)
  return tokens
}

function formatLiveBackgroundRow(
  record: TaskRecord,
  activity: string,
  now: number,
  maxWidth: number,
  stats?: TaskRunStats,
): string {
  const identity = excerptRendererText(
    taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description, taskSummary: record.task_summary }),
    stats === undefined ? LIVE_DESCRIPTION_MAX : LIVE_DESCRIPTION_MAX_WITH_STATS,
  )
  const elapsed = formatElapsed(record.created_at, now)
  const frame = SPINNER_FRAMES[Math.floor(now / LIVE_STATUS_REFRESH_MS) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]
  const parts = [
    frame,
    identity,
    recordStatusTarget(record),
    ...liveStatsTokens(stats),
    activity,
    elapsed,
  ]
  return excerptRendererText(parts.join(" · ").replace(`${frame} · `, `${frame} `), maxWidth)
}

function formatElapsed(createdAt: string, now: number): string {
  const startedAt = Date.parse(createdAt)
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1_000)) : 0
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`
}

export function backgroundWidgetRows(
  records: readonly TaskRecord[],
  activity: ReadonlyMap<string, string>,
  now: number,
  liveStats?: (taskId: string) => TaskRunStats | undefined,
): string[] {
  const active = records.filter((record) => !isTerminal(record.status))
  if (active.length === 0) return []
  const shown = active.slice(0, MAX_WIDGET_ROWS).map((record) =>
    formatLiveBackgroundRow(record, activity.get(record.task_id) ?? "running", now, LIVE_WIDGET_LINE_MAX, liveStats?.(record.task_id)),
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
    taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description, taskSummary: record.task_summary }),
    maxWidth,
  )
}

function compactTaskContext(record: TaskRecord): string {
  return [
    excerptRendererText(recordStatusTarget(record), 46),
    excerptRendererText(record.execution_mode, 10),
    excerptRendererText(record.status, 7),
  ].filter((part): part is string => part !== undefined).join(" ")
}
