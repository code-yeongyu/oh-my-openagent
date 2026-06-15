import type { BackgroundTask, BackgroundTaskStatus } from "../types"

/**
 * Identity of the process that owns a persisted task. Used by the store layer
 * to fence stale snapshots written by a previous (now-dead) process.
 */
export interface SnapshotOwner {
  pid: number
  /** ISO 8601 timestamp of when the owning process started. */
  startedAt: string
}

/** Subset of model configuration that is safe and useful to persist. */
export interface PersistedModelConfig {
  providerID: string
  modelID: string
  variant?: string
}

/**
 * On-disk representation of a {@link BackgroundTask}. The launch `prompt` is
 * intentionally absent: it must never be written to disk (registry precedent
 * redacts prompts). Dates are stored as ISO 8601 strings.
 */
export interface PersistedTaskSnapshot {
  schema_version: 1
  id: string
  sessionId?: string
  rootSessionId?: string
  parentSessionId?: string
  parentMessageId?: string
  description: string
  agent: string
  category?: string
  model?: PersistedModelConfig
  status: BackgroundTaskStatus
  queuedAt?: string
  startedAt?: string
  completedAt?: string
  error?: string
  concurrencyGroup?: string
  concurrencyKey?: string
  teamRunId?: string
  spawnDepth?: number
  owner: SnapshotOwner
  updatedAt: string
}

const PROMPT_PLACEHOLDER = "[not persisted across restart]"

function toISO(date: Date | undefined): string | undefined {
  return date ? date.toISOString() : undefined
}

function fromISO(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** Convert a live {@link BackgroundTask} into its persisted snapshot form. */
export function taskToSnapshot(
  task: BackgroundTask,
  owner: SnapshotOwner,
): PersistedTaskSnapshot {
  return {
    schema_version: 1,
    id: task.id,
    sessionId: task.sessionId,
    rootSessionId: task.rootSessionId,
    parentSessionId: task.parentSessionId,
    parentMessageId: task.parentMessageId,
    description: task.description,
    agent: task.agent,
    category: task.category,
    model: task.model
      ? {
          providerID: task.model.providerID,
          modelID: task.model.modelID,
          variant: task.model.variant,
        }
      : undefined,
    status: task.status,
    queuedAt: toISO(task.queuedAt),
    startedAt: toISO(task.startedAt),
    completedAt: toISO(task.completedAt),
    error: task.error,
    concurrencyGroup: task.concurrencyGroup,
    concurrencyKey: task.concurrencyKey,
    teamRunId: task.teamRunId,
    spawnDepth: task.spawnDepth,
    owner,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Reconstruct a {@link BackgroundTask} from a persisted snapshot. The `prompt`
 * is set to a placeholder because it was never written to disk; required
 * parent identifiers fall back to empty strings when absent.
 */
export function snapshotToTask(snapshot: PersistedTaskSnapshot): BackgroundTask {
  return {
    id: snapshot.id,
    sessionId: snapshot.sessionId,
    rootSessionId: snapshot.rootSessionId,
    parentSessionId: snapshot.parentSessionId ?? "",
    parentMessageId: snapshot.parentMessageId ?? "",
    teamRunId: snapshot.teamRunId,
    description: snapshot.description,
    prompt: PROMPT_PLACEHOLDER,
    agent: snapshot.agent,
    spawnDepth: snapshot.spawnDepth,
    status: snapshot.status,
    queuedAt: fromISO(snapshot.queuedAt),
    startedAt: fromISO(snapshot.startedAt),
    completedAt: fromISO(snapshot.completedAt),
    error: snapshot.error,
    concurrencyKey: snapshot.concurrencyKey,
    concurrencyGroup: snapshot.concurrencyGroup,
    category: snapshot.category,
    model: snapshot.model
      ? {
          providerID: snapshot.model.providerID,
          modelID: snapshot.model.modelID,
          variant: snapshot.model.variant,
        }
      : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Parse the contents of a snapshot file. Returns `undefined` (never throws) on
 * invalid JSON, an unsupported `schema_version`, a missing/non-string `id`, or
 * a missing `owner`.
 */
export function parseSnapshotFile(
  content: string,
): PersistedTaskSnapshot | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }

  if (!isRecord(parsed)) return undefined
  if (parsed.schema_version !== 1) return undefined
  if (typeof parsed.id !== "string" || parsed.id.length === 0) return undefined
  if (!isRecord(parsed.owner)) return undefined

  return parsed as unknown as PersistedTaskSnapshot
}
