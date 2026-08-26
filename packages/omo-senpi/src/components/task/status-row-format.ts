import {
  excerptRendererText,
  formatLiveSpend,
  formatStatusTarget,
  formatTargetWithModel,
  normalizeRendererText,
  parseTeamMemberTaskIdentity,
  rendererVisibleWidth,
  taskIdentityLabel,
  toolCountSuffix,
  type ResidencyState,
  type TaskRecord,
  type TaskRunStats,
  type TaskStatus,
} from "@oh-my-opencode/senpi-task"

const MAX_WIDGET_ROWS = 5
const WIDGET_LINE_MAX = 70
const LIVE_WIDGET_LINE_MAX = 220
const PROGRESS_HEAD_MAX = 60
const LIVE_IDENTITY_MAX = 80
const LIVE_IDENTITY_MIN = 12
const LIVE_TARGET_MIN = 20
const LIVE_ACTIVITY_MIN = 8
const LIVE_SEPARATOR_WIDTH = 3
export const LIVE_STATUS_REFRESH_MS = 250
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

const SUSPENDED_RESIDENCIES: ReadonlySet<ResidencyState> = new Set(["persisted_only", "rpc_detached"])

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

function isSuspended(record: TaskRecord): boolean {
  return SUSPENDED_RESIDENCIES.has(record.residency_state)
}

// Maps a record's residency to its user-facing status label: suspended children show `suspended`
// instead of their raw status so the row reads `status:suspended` rather than `status:running`.
function statusLabel(record: TaskRecord): string {
  return isSuspended(record) ? "suspended" : normalizeRendererText(record.status)
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
  parts.push(`mode:${normalizeRendererText(record.execution_mode)}`, `status:${statusLabel(record)}`)
  if (record.pid !== undefined) parts.push(`pid:${record.pid}`)
  const progress = progressHead(record)
  if (progress !== undefined) parts.push(`progress:${progress}`)
  return parts.join(" ")
}

function selectWidgetRecords(records: readonly TaskRecord[], residentTaskIds: ReadonlySet<string>): TaskRecord[] {
  const active = records.filter((record) => !isTerminal(record.status))
  const completedResidentMembers = records.filter((record) =>
    record.status === "completed"
    && residentTaskIds.has(record.task_id)
    && parseTeamMemberTaskIdentity(record) !== undefined,
  )
  return [...active, ...completedResidentMembers]
}

export function buildWidgetRows(records: readonly TaskRecord[], residentTaskIds: ReadonlySet<string> = new Set()): string[] {
  const selected = selectWidgetRecords(records, residentTaskIds)
  if (selected.length === 0) return []
  const shown = selected.slice(0, MAX_WIDGET_ROWS).map((record) => formatCompactTaskRow(record, WIDGET_LINE_MAX, true))
  const overflow = selected.length - MAX_WIDGET_ROWS
  if (overflow > 0) shown.push(`+${overflow} more`)
  return shown
}

function liveStatsTokens(stats: TaskRunStats | undefined): string[] {
  if (stats === undefined) return []
  const tokens = [`turn ${stats.turns}${toolCountSuffix(stats.tool_calls)}`]
  const spend = formatLiveSpend(stats)
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
  const elapsed = formatElapsed(record.created_at, now)
  const frame = SPINNER_FRAMES[Math.floor(now / LIVE_STATUS_REFRESH_MS) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]
  const fullIdentity = liveTaskIdentity(record)
  const fullTarget = recordStatusTarget(record)
  const fullActivity = isSuspended(record) ? "suspended" : normalizeRendererText(activity)
  const minimumPartsWidth = rendererVisibleWidth(
    `${frame} ${excerptRendererText(fullIdentity, LIVE_IDENTITY_MIN)} · ${excerptRendererText(fullTarget, LIVE_TARGET_MIN)} · ${excerptRendererText(fullActivity, LIVE_ACTIVITY_MIN)} · ${elapsed}`,
  )
  let remainingWidth = Math.max(0, maxWidth - minimumPartsWidth)
  const statsTokens = liveStatsTokens(stats).filter((token) => {
    const tokenWidth = rendererVisibleWidth(token) + LIVE_SEPARATOR_WIDTH
    if (tokenWidth > remainingWidth) return false
    remainingWidth -= tokenWidth
    return true
  })
  const activityWidth = Math.min(rendererVisibleWidth(fullActivity), LIVE_ACTIVITY_MIN + remainingWidth)
  remainingWidth -= Math.max(0, activityWidth - LIVE_ACTIVITY_MIN)
  const targetWidth = Math.min(rendererVisibleWidth(fullTarget), LIVE_TARGET_MIN + remainingWidth)
  remainingWidth -= Math.max(0, targetWidth - LIVE_TARGET_MIN)
  const identityWidth = Math.min(LIVE_IDENTITY_MAX, LIVE_IDENTITY_MIN + remainingWidth)
  const context = [
    excerptRendererText(fullTarget, targetWidth),
    ...statsTokens,
    excerptRendererText(fullActivity, activityWidth),
    elapsed,
  ]
  const contextText = context.join(" · ")
  const identity = excerptRendererText(fullIdentity, identityWidth)
  return excerptRendererText(`${frame} ${identity} · ${contextText}`, maxWidth)
}

export function taskStatusDescription(record: TaskRecord): string {
  return optionalRendererText(record.task_summary)
    ?? optionalRendererText(record.description)
    ?? optionalRendererText(record.name)
    ?? normalizeRendererText(record.task_id)
}

function liveTaskIdentity(record: TaskRecord): string {
  return taskStatusDescription(record)
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
  maxWidth = LIVE_WIDGET_LINE_MAX,
  residentTaskIds: ReadonlySet<string> = new Set(),
): string[] {
  const selected = selectWidgetRecords(records, residentTaskIds)
  if (selected.length === 0) return []
  const boundedWidth = Number.isFinite(maxWidth) && maxWidth > 0
    ? Math.min(LIVE_WIDGET_LINE_MAX, Math.floor(maxWidth))
    : LIVE_WIDGET_LINE_MAX
  const shown = selected.slice(0, MAX_WIDGET_ROWS).map((record) =>
    record.status === "completed"
      ? formatCompactTaskRow(record, boundedWidth, true)
      : formatLiveBackgroundRow(record, activity.get(record.task_id) ?? "running", now, boundedWidth, liveStats?.(record.task_id)),
  )
  const overflow = selected.length - MAX_WIDGET_ROWS
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
    excerptRendererText(statusLabel(record), 9),
  ].filter((part): part is string => part !== undefined).join(" ")
}
