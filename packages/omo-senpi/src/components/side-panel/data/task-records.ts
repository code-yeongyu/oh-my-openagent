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

/** Map one persisted record onto a panel row update. */
export function panelChildFromRecord(record: PanelTaskRecord): PanelChildUpdate {
  const stats = record.run_stats
  return {
    id: record.task_id,
    name: label(record),
    ...(record.category === undefined ? {} : { category: record.category }),
    status: STATUS[record.status] ?? "queued",
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
