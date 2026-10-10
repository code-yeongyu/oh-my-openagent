import {
  buildLiveStatsTokens,
  deferralOutlookFor,
  type DeferralOutlook,
  excerptRendererText,
  formatStatusTarget,
  formatTargetWithModel,
  normalizeRendererText,
  parseTeamMemberTaskIdentity,
  rendererVisibleWidth,
  selectLiveActivityVerb,
  taskIdentityLabel,
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
// A parked child is not working, so its row gets a still mark instead of a spinner frame.
const SUSPENDED_MARK = "‖"

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Whether a live child is parked rather than running here. The side panel's rule: a host that gave
 * up records `suspension_reason`, while an ordinary suspension (the parent session ended or
 * restarted) shows up only as a residency other than `resident`. Only a child that has not
 * finished can be parked; a finished child is `evicted` or `disposed` and keeps its own status.
 */
export function isSuspended(record: TaskRecord): boolean {
  if (isTerminal(record.status)) return false
  return record.suspension_reason !== undefined || record.residency_state !== "resident"
}

type SuspensionReason = NonNullable<TaskRecord["suspension_reason"]>

// Each cause in words. What brings the child back is decided per record below, from the same
// facts the engine uses: nothing watches for the cause to clear.
const SUSPENSION_CAUSES: Readonly<Record<SuspensionReason, string>> = {
  daemon_unavailable: "task daemon unavailable",
  handoff_parked: "handed off",
  host_draining: "host draining",
  host_incompatible: "host version mismatch",
  idle_evicted: "evicted while idle",
  own_host_unreachable: "host lost",
  revival_deferred: "revival deferred",
  store_index_unavailable: "task store unavailable",
}

const PARENT_RESTARTED_CAUSE = "parent session restarted"

// What a deferred revival does next (the engine's own outlook, see deferralOutlookFor).
const DEFERRAL_OUTLOOKS: Readonly<Record<DeferralOutlook, string>> = {
  waits_for_capacity: "retried when a running child ends, else on session restart",
  may_stay_with_live_owner: "held by another live session",
  retried_then_lost: "retried a few times, then marked lost",
  retried_not_lost: "retried a few times, else waits for its host",
  not_retried: "resumes on session restart",
}

/**
 * Whether a message can bring a parked child back. task_send revives only a running daemon-hosted
 * child parked at `rpc_detached` (messageability: `revive`); every other parked child resumes only
 * with its session.
 */
function revivableByMessage(record: TaskRecord): boolean {
  return record.status === "running"
    && record.residency_state === "rpc_detached"
    && record.runner_kind === "host-session"
    && record.host_session !== undefined
}

function suspensionResumes(record: TaskRecord): string {
  const byMessage = revivableByMessage(record)
  switch (record.suspension_reason) {
    case "host_incompatible":
      return "will not resume"
    case "idle_evicted":
      return byMessage ? "resumes on a message" : "resumes on session restart"
    case "revival_deferred":
      return DEFERRAL_OUTLOOKS[deferralOutlookFor(record.revival_deferred_reason ?? "", byMessage || record.runner_kind === "host-session")]
    default:
      return byMessage ? "resumes on session restart or a message" : "resumes on session restart"
  }
}

// Why the child is parked, in words: the host's recorded reason, or the parent restarting away.
function suspensionCause(record: TaskRecord): string {
  const cause = record.suspension_reason === undefined ? PARENT_RESTARTED_CAUSE : SUSPENSION_CAUSES[record.suspension_reason]
  const deferred = optionalRendererText(record.revival_deferred_reason)
  return record.suspension_reason === "revival_deferred" && deferred !== undefined ? `${cause}: ${deferred}` : cause
}

const CANCEL_HINT = "/task-kill to cancel"

// How a parked child goes on: when it resumes by itself, and the user's one action. A narrow line
// keeps only the action.
function suspensionHints(record: TaskRecord): readonly string[] {
  return [`${suspensionResumes(record)}; ${CANCEL_HINT}`, CANCEL_HINT]
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

// The stats segment of the live row, drawn from the ONE shared builder so this grammar cannot
// drift from composeStatusLine: a run with no successful turn and no tool call renders no turn
// token, failed attempts render as their own counter, and spend follows reported cost.
function liveStatsTokens(stats: TaskRunStats | undefined): string[] {
  if (stats === undefined) return []
  const tokens = buildLiveStatsTokens(stats)
  return [tokens.turn, tokens.failed, tokens.spend, tokens.throughput].filter(
    (token): token is string => token !== undefined,
  )
}

// Fallback verb when no live activity has arrived for a background child: stats-derived, so a run
// with no successful turn reads "starting" - or "retrying" once a failure proved the child is
// alive - instead of claiming "running". Without stats the legacy "running" holds: the child is
// alive, but its turn facts are unknown here.
function defaultLiveActivity(stats: TaskRunStats | undefined): string {
  if (stats === undefined) return "running"
  return selectLiveActivityVerb({ turns: stats.turns, failedTurns: stats.failed_turns })
}

function formatLiveBackgroundRow(
  record: TaskRecord,
  activity: string | undefined,
  now: number,
  maxWidth: number,
  stats?: TaskRunStats,
): string {
  const suspended = isSuspended(record)
  // A parked child shows no running time: the record has no park timestamp (`updated_at` moves with
  // every revival attempt), and a climbing timer is what made the row look alive.
  const elapsed = suspended ? undefined : formatElapsed(record.created_at, now)
  const frame = suspended
    ? SUSPENDED_MARK
    : SPINNER_FRAMES[Math.floor(now / LIVE_STATUS_REFRESH_MS) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0]
  const fullIdentity = liveTaskIdentity(record)
  const fullTarget = recordStatusTarget(record)
  const fullActivity = suspended
    ? `suspended (${suspensionCause(record)})`
    : activity === undefined
      ? defaultLiveActivity(stats)
      : normalizeRendererText(activity)
  const minimumPartsWidth = rendererVisibleWidth(
    `${frame} ${excerptRendererText(fullIdentity, LIVE_IDENTITY_MIN)} · ${excerptRendererText(fullTarget, LIVE_TARGET_MIN)} · ${excerptRendererText(fullActivity, LIVE_ACTIVITY_MIN)}${elapsed === undefined ? "" : ` · ${elapsed}`}`,
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
  // After the cause, a parked row says how to act on it, when the line has room.
  const fittingHint = suspended
    ? suspensionHints(record).find((candidate) => rendererVisibleWidth(candidate) + LIVE_SEPARATOR_WIDTH <= remainingWidth)
    : undefined
  const hint = fittingHint === undefined ? [] : [fittingHint]
  remainingWidth -= fittingHint === undefined ? 0 : rendererVisibleWidth(fittingHint) + LIVE_SEPARATOR_WIDTH
  // A parked row has no live activity to watch, so which child it is matters more than its route.
  let targetWidth: number
  let identityWidth: number
  if (suspended) {
    identityWidth = Math.min(LIVE_IDENTITY_MAX, rendererVisibleWidth(fullIdentity), LIVE_IDENTITY_MIN + remainingWidth)
    remainingWidth -= Math.max(0, identityWidth - LIVE_IDENTITY_MIN)
    targetWidth = Math.min(rendererVisibleWidth(fullTarget), LIVE_TARGET_MIN + remainingWidth)
  } else {
    targetWidth = Math.min(rendererVisibleWidth(fullTarget), LIVE_TARGET_MIN + remainingWidth)
    remainingWidth -= Math.max(0, targetWidth - LIVE_TARGET_MIN)
    identityWidth = Math.min(LIVE_IDENTITY_MAX, LIVE_IDENTITY_MIN + remainingWidth)
  }
  const context = [
    excerptRendererText(fullTarget, targetWidth),
    ...statsTokens,
    excerptRendererText(fullActivity, activityWidth),
    ...(elapsed === undefined ? [] : [elapsed]),
    ...hint,
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
      : formatLiveBackgroundRow(record, activity.get(record.task_id), now, boundedWidth, liveStats?.(record.task_id)),
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
