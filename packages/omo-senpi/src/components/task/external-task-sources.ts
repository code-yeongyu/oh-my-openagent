import { excerptRendererText, normalizeRendererText } from "@oh-my-opencode/senpi-task"

// Read-only rows for agents that run outside this engine (for example a Claude Code Workflow
// driven from this session). Another extension registers a source; the task widget, /tasks and
// omo.task.updated list its rows next to native tasks. There is no steer or cancel path: the rows
// never enter the task store, so task_send / task_cancel / /task-kill cannot address them.
export type ExternalTaskStatus = "running" | "stalled" | "done" | "failed"

export interface ExternalTaskRow {
  readonly id: string
  readonly label: string
  readonly status: ExternalTaskStatus
  readonly phase?: string
  readonly model?: string
  readonly activity?: string
  readonly group?: string
  // Epoch milliseconds.
  readonly startedAt?: number
  readonly lastActivityAt?: number
}

export interface ExternalTaskSource {
  readonly id: string
  readonly label: string
  // Scopes the rows to one parent session; a source without it is shown in every session.
  readonly sessionId?: string
  list(): readonly ExternalTaskRow[]
}

export interface ExternalTaskSnapshot {
  readonly sourceId: string
  readonly sourceLabel: string
  readonly rows: readonly ExternalTaskRow[]
}

export interface ExternalTaskSnapshotOptions {
  readonly allSessions?: boolean
}

export interface ExternalTaskSources {
  // Registering a source with the same id and session replaces the previous one. The returned
  // function unregisters this registration only.
  register(source: ExternalTaskSource): () => void
  // Sources call this when their rows changed; subscribers repaint.
  changed(): void
  subscribe(listener: () => void): () => void
  snapshot(sessionId: string | undefined, options?: ExternalTaskSnapshotOptions): readonly ExternalTaskSnapshot[]
}

// Senpi rebuilds every module-scope binding per extension load and other extensions load through
// their own importer, so the shared registry hangs off globalThis under a registered symbol - the
// same contract as omo.task.terminalObservers. Tests inject isolated registries instead.
export const EXTERNAL_TASK_SOURCES_KEY = Symbol.for("omo.task.externalSources")

const EXTERNAL_STATUSES: ReadonlySet<string> = new Set(["running", "stalled", "done", "failed"])
const MAX_ROWS_PER_SOURCE = 256
const MAX_TEXT = 512

export function createExternalTaskSources(onSourceError?: (sourceId: string, error: unknown) => void): ExternalTaskSources {
  const sources = new Map<string, ExternalTaskSource>()
  const listeners = new Set<() => void>()
  const keyOf = (source: ExternalTaskSource): string => `${source.id}\u0000${source.sessionId ?? ""}`

  function changed(): void {
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        onSourceError?.("listener", error)
      }
    }
  }

  return {
    register(source) {
      const key = keyOf(source)
      sources.set(key, source)
      changed()
      return () => {
        if (sources.get(key) !== source) return
        sources.delete(key)
        changed()
      }
    },
    changed,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot(sessionId, options = {}) {
      const snapshots: ExternalTaskSnapshot[] = []
      for (const source of sources.values()) {
        const inScope = options.allSessions === true || source.sessionId === undefined || source.sessionId === sessionId
        if (!inScope) continue
        let listed: readonly ExternalTaskRow[]
        try {
          listed = source.list()
        } catch (error) {
          // A failing source loses its rows for this frame; it must never break the task widget.
          onSourceError?.(source.id, error)
          continue
        }
        const rows = (Array.isArray(listed) ? listed : []).flatMap((row) => {
          const valid = validRow(row)
          return valid === undefined ? [] : [valid]
        }).slice(0, MAX_ROWS_PER_SOURCE)
        if (rows.length > 0) snapshots.push({ sourceId: text(source.id), sourceLabel: text(source.label), rows })
      }
      return snapshots
    },
  }
}

function isExternalTaskSources(value: unknown): value is ExternalTaskSources {
  if (typeof value !== "object" || value === null) return false
  const candidate: Partial<ExternalTaskSources> = value
  return typeof candidate.register === "function"
    && typeof candidate.changed === "function"
    && typeof candidate.subscribe === "function"
    && typeof candidate.snapshot === "function"
}

export function sharedExternalTaskSources(): ExternalTaskSources {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const existing = registry[EXTERNAL_TASK_SOURCES_KEY]
  if (isExternalTaskSources(existing)) return existing
  const created = createExternalTaskSources()
  registry[EXTERNAL_TASK_SOURCES_KEY] = created
  return created
}

// Validation must not touch the lazily loaded pi-tui module: a source may snapshot before the
// task component has awaited loadPiTui(), so this caps by code points instead of display width.
function text(value: string): string {
  return [...normalizeRendererText(value)].slice(0, MAX_TEXT).join("")
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = text(value)
  return normalized.length === 0 ? undefined : normalized
}

function optionalTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

// Rows come from another extension, so they are validated and sanitized here at the boundary.
function validRow(row: unknown): ExternalTaskRow | undefined {
  if (typeof row !== "object" || row === null) return undefined
  const candidate = row as Record<string, unknown>
  const id = optionalText(candidate["id"])
  const label = optionalText(candidate["label"])
  const status = candidate["status"]
  if (id === undefined || label === undefined || typeof status !== "string" || !EXTERNAL_STATUSES.has(status)) return undefined
  const phase = optionalText(candidate["phase"])
  const model = optionalText(candidate["model"])
  const activity = optionalText(candidate["activity"])
  const group = optionalText(candidate["group"])
  const startedAt = optionalTime(candidate["startedAt"])
  const lastActivityAt = optionalTime(candidate["lastActivityAt"])
  return {
    id,
    label,
    status: status as ExternalTaskStatus,
    ...(phase === undefined ? {} : { phase }),
    ...(model === undefined ? {} : { model }),
    ...(activity === undefined ? {} : { activity }),
    ...(group === undefined ? {} : { group }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
  }
}

const MAX_EXTERNAL_WIDGET_ROWS = 5
const EXTERNAL_WIDGET_LINE_MAX = 220

function isOpen(row: ExternalTaskRow): boolean {
  return row.status === "running" || row.status === "stalled"
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function externalWidgetRows(snapshots: readonly ExternalTaskSnapshot[], now: number, maxWidth = EXTERNAL_WIDGET_LINE_MAX): string[] {
  const width = Number.isFinite(maxWidth) && maxWidth > 0 ? Math.min(EXTERNAL_WIDGET_LINE_MAX, Math.floor(maxWidth)) : EXTERNAL_WIDGET_LINE_MAX
  const open = snapshots.flatMap((snapshot) => snapshot.rows.filter(isOpen).map((row) => ({ snapshot, row })))
  const shown = open.slice(0, MAX_EXTERNAL_WIDGET_ROWS).map(({ snapshot, row }) => {
    const parts = [
      row.label,
      snapshot.sourceLabel,
      row.phase,
      row.model,
      row.activity,
      row.startedAt === undefined ? undefined : formatAge(now - row.startedAt),
      row.status === "stalled" && row.lastActivityAt !== undefined ? `stalled ${formatAge(now - row.lastActivityAt)}` : undefined,
    ].filter((part): part is string => part !== undefined)
    return excerptRendererText(`${row.status === "stalled" ? "!" : "↗"} ${parts.join(" · ")}`, width)
  })
  const overflow = open.length - MAX_EXTERNAL_WIDGET_ROWS
  if (overflow > 0) shown.push(`+${overflow} more external`)
  return shown
}

export function formatExternalTaskRow(snapshot: ExternalTaskSnapshot, row: ExternalTaskRow): string {
  const parts = [row.label, `(${snapshot.sourceId}:${row.id})`, `status:${row.status}`]
  if (row.phase !== undefined) parts.push(`phase:${row.phase}`)
  if (row.model !== undefined) parts.push(`model:${row.model}`)
  if (row.activity !== undefined) parts.push(`activity:${row.activity}`)
  parts.push("external:read-only")
  return parts.join(" ")
}

export interface ExternalTaskPayload {
  readonly source_id: string
  readonly source_label: string
  readonly id: string
  readonly label: string
  readonly status: ExternalTaskStatus
  readonly phase?: string
  readonly model?: string
  readonly activity?: string
  readonly group?: string
  readonly started_at?: string
  readonly last_activity_at?: string
}

// omo.task.updated wire shape: snake_case like the native task snapshots, ISO timestamps.
export function externalTaskPayload(snapshots: readonly ExternalTaskSnapshot[]): ExternalTaskPayload[] {
  return snapshots.flatMap((snapshot) => snapshot.rows.map((row) => ({
    source_id: snapshot.sourceId,
    source_label: snapshot.sourceLabel,
    id: row.id,
    label: row.label,
    status: row.status,
    ...(row.phase === undefined ? {} : { phase: row.phase }),
    ...(row.model === undefined ? {} : { model: row.model }),
    ...(row.activity === undefined ? {} : { activity: row.activity }),
    ...(row.group === undefined ? {} : { group: row.group }),
    ...(row.startedAt === undefined ? {} : { started_at: new Date(row.startedAt).toISOString() }),
    ...(row.lastActivityAt === undefined ? {} : { last_activity_at: new Date(row.lastActivityAt).toISOString() }),
  })))
}
