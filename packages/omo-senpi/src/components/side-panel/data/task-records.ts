import { recoveryPresentation } from "@oh-my-opencode/senpi-task"
import type { PanelChildStatus, PanelChildUpdate } from "../store"

/**
 * The delegated-children source. Records are read straight from the task engine's own
 * durable store, so the panel needs nothing from the task component and cannot perturb it.
 */

/** Only the fields the panel reads. senpi-task's `TaskRecord` satisfies this structurally. */
export interface PanelTaskRecord {
  readonly task_id: string
  readonly status: string
  readonly created_at: string
  readonly started_at?: string
  readonly terminal_at?: string
  readonly parent_session_id?: string
  readonly task_summary?: string
  readonly description?: string
  readonly name?: string
  readonly category?: string
  readonly agent_type?: string
  /** Set while the engine is holding a child rather than running it; absent means it is not parked. */
  readonly failure_kind?: string
  readonly error_message?: string
  readonly suspension_reason?: string
  /** "resident" is the only value that means the child is live in this process. */
  readonly residency_state?: string
  /** "host-session" is a session of the shared daemon; "child-process" is the rpc-process runner. */
  readonly runner_kind?: string
  readonly execution_mode?: string
  readonly run_stats?: PanelTaskRunStats
}

export interface PanelTaskRunStats {
  readonly turns?: number
  readonly total_tokens?: number
  readonly cost_usd?: number
}

const STATUS: Record<string, PanelChildStatus> = {
  pending: "queued",
  running: "running",
  completed: "finished",
  error: "failed",
  lost: "failed",
  cancelled: "cancelled",
  interrupted: "cancelled",
}

/**
 * A parked child keeps the status it had, so reading `status` alone paints it as still working.
 * Only a live child can be parked: a reason left on a terminal record describes a past life.
 *
 * Two independent facts say "not running here". `suspension_reason` is set only when the daemon
 * path gave up on a reachable host, while the ORDINARY suspension - the one that resumes with the
 * session - sets no reason at all and shows up solely as a residency that is no longer
 * `resident`. Reading the reason alone therefore still leaves a detached child painted as
 * working, with its elapsed timer climbing, which is the thing this column exists to prevent.
 */
function childStatus(record: PanelTaskRecord): PanelChildStatus {
  const mapped = STATUS[record.status] ?? "queued"
  if (mapped !== "running" && mapped !== "queued") return mapped
  return recoveryPresentation(record)?.state ?? mapped
}

/**
 * Which lane runs the child. The two runner kinds fail in different ways - a daemon session
 * outlives this process and can lose its daemon, a child process dies with its pipe - so the card
 * names the lane rather than leaving both looking alike. The host's own words, mapped only where
 * its internal spelling would read as jargon in a card.
 */
function childHost(record: PanelTaskRecord): string | undefined {
  if (record.runner_kind === "host-session") return "daemon session"
  if (record.runner_kind === "child-process") return "child process"
  return record.execution_mode
}

/** Map one persisted record onto a panel row update. */
export function panelChildFromRecord(record: PanelTaskRecord): PanelChildUpdate {
  const stats = record.run_stats
  return {
    id: record.task_id,
    name: label(record),
    ...(record.category === undefined ? {} : { category: record.category }),
    status: childStatus(record),
    ...(recoveryPresentation(record) !== undefined
      ? { parkedReason: recoveryPresentation(record)?.cause }
      : {}),
    ...(childHost(record) === undefined ? {} : { host: childHost(record) }),
    startedAt: timestamp(record.started_at) ?? timestamp(record.created_at) ?? 0,
    ...(timestamp(record.terminal_at) === undefined ? {} : { finishedAt: timestamp(record.terminal_at) }),
    ...(stats?.turns === undefined ? {} : { turns: stats.turns }),
    ...(stats?.total_tokens === undefined ? {} : { tokens: stats.total_tokens }),
    // A missing cost is not a zero cost, so it is left absent rather than defaulted.
    ...(stats?.cost_usd === undefined ? {} : { cost: stats.cost_usd }),
  }
}

/**
 * Children of this session only. Without a session id there is nothing to scope by, so the
 * list comes back empty rather than leaking every session's tasks into the column.
 */
export function panelChildrenFromRecords(
  records: readonly PanelTaskRecord[],
  sessionId: string | undefined,
): readonly PanelChildUpdate[] {
  if (sessionId === undefined || sessionId === "") return []
  return records.filter((record) => record.parent_session_id === sessionId).map(panelChildFromRecord)
}

/** The label the task surfaces lead with: summary, then description, then name, then the id. */
function label(record: PanelTaskRecord): string {
  for (const candidate of [record.task_summary, record.description, record.name, record.agent_type]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim()
  }
  return record.task_id
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
