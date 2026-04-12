import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDataDir } from "../../shared/data-path"
import { log } from "../../shared"

const DEFAULT_RECOVERY_LOOKBACK_MS = 24 * 60 * 60 * 1000
const DEFAULT_RECOVERY_LIMIT = 200
const DEFAULT_TASK_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_TASK_LOOKUP_LIMIT = 5000
const TASK_ID_PATTERN = /Background Task ID:\s*(bg_[a-z0-9]+)/i

export interface RecoverableBackgroundLaunch {
  taskID: string
  sessionID: string
  parentSessionID: string
  parentMessageID: string
  description: string
  agent: string
  category?: string
  startedAt: Date
}

export interface PersistedBackgroundTaskSnapshot extends RecoverableBackgroundLaunch {
  hasParentCompletionNotification: boolean
}

function getDbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

function getString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function getNumber(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "bigint") {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
  }
  return undefined
}

function extractTaskID(output: string | undefined): string | undefined {
  if (!output) return undefined
  const match = output.match(TASK_ID_PATTERN)
  return match?.[1]
}

function hasParentCompletionNotification(
  db: Database,
  parentSessionID: string,
  launchedAt: number,
  taskID: string,
): boolean {
  const rows = db.query(`
    SELECT json_extract(data, '$.text') AS text
    FROM part
    WHERE session_id = ?
      AND time_created > ?
      AND json_extract(data, '$.type') = 'text'
      AND json_extract(data, '$.text') LIKE ?
    ORDER BY time_created ASC
    LIMIT 20
  `).all(parentSessionID, launchedAt, `%${taskID}%`) as Array<Record<string, unknown>>

  return rows.some((row) => {
    const text = getString(row, "text")
    return !!text && (
      text.includes(`**ID:** \`${taskID}\``)
      || text.includes(`- \`${taskID}\`:`)
    )
  })
}

function queryLaunchRows(
  db: Database,
  cutoff: number,
  limit: number,
  taskID?: string,
): Array<Record<string, unknown>> {
  const taskIdClause = taskID
    ? `
        AND (
          json_extract(p.data, '$.state.metadata.taskId') = ?
          OR json_extract(p.data, '$.state.metadata.taskID') = ?
          OR json_extract(p.data, '$.state.output') LIKE ?
        )
      `
    : ""

  const query = `
    SELECT
      p.session_id AS parent_session_id,
      p.message_id AS parent_message_id,
      p.time_created AS launch_time,
      json_extract(p.data, '$.state.input.description') AS description,
      COALESCE(
        json_extract(p.data, '$.state.input.subagent_type'),
        json_extract(p.data, '$.state.metadata.agent')
      ) AS agent,
      json_extract(p.data, '$.state.input.category') AS category,
      json_extract(p.data, '$.state.output') AS output,
      COALESCE(
        json_extract(p.data, '$.state.metadata.taskId'),
        json_extract(p.data, '$.state.metadata.taskID')
      ) AS structured_task_id,
      COALESCE(
        json_extract(p.data, '$.state.metadata.sessionId'),
        json_extract(p.data, '$.state.metadata.sessionID')
      ) AS child_session_id
    FROM part p
    WHERE json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.tool') = 'task'
      AND json_extract(p.data, '$.state.input.run_in_background') = 1
      AND p.time_created >= ?
      ${taskIdClause}
    ORDER BY p.time_created DESC
    LIMIT ?
  `

  if (!taskID) {
    return db.query(query).all(cutoff, limit) as Array<Record<string, unknown>>
  }

  return db.query(query).all(cutoff, taskID, taskID, `%${taskID}%`, limit) as Array<Record<string, unknown>>
}

function buildSnapshot(
  db: Database,
  row: Record<string, unknown>,
): PersistedBackgroundTaskSnapshot | undefined {
  const parentSessionID = getString(row, "parent_session_id")
  const parentMessageID = getString(row, "parent_message_id")
  const sessionID = getString(row, "child_session_id")
  const description = getString(row, "description")
  const agent = getString(row, "agent") ?? "task"
  const category = getString(row, "category")
  const launchedAt = getNumber(row, "launch_time")
  const output = getString(row, "output")
  const taskID = getString(row, "structured_task_id") ?? extractTaskID(output)

  if (!parentSessionID || !parentMessageID || !sessionID || !description || !launchedAt || !taskID) {
    return undefined
  }

  return {
    taskID,
    sessionID,
    parentSessionID,
    parentMessageID,
    description,
    agent,
    ...(category ? { category } : {}),
    startedAt: new Date(launchedAt),
    hasParentCompletionNotification: hasParentCompletionNotification(db, parentSessionID, launchedAt, taskID),
  }
}

export function loadPersistedBackgroundTask(taskID: string, options?: {
  now?: number
  lookbackMs?: number
  limit?: number
}): PersistedBackgroundTaskSnapshot | undefined {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    return undefined
  }

  const now = options?.now ?? Date.now()
  const lookbackMs = options?.lookbackMs ?? DEFAULT_TASK_LOOKBACK_MS
  const limit = options?.limit ?? DEFAULT_TASK_LOOKUP_LIMIT
  const cutoff = now - lookbackMs

  let db: Database | undefined
  try {
    db = new Database(dbPath)
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA busy_timeout = 60000;")

    const rows = queryLaunchRows(db, cutoff, limit, taskID)
    for (const row of rows) {
      const snapshot = buildSnapshot(db, row)
      if (snapshot?.taskID === taskID) {
        return snapshot
      }
    }

    return undefined
  } catch (error) {
    log("[background-agent] Failed to load persisted background task:", {
      taskID,
      error: String(error),
    })
    return undefined
  } finally {
    db?.close()
  }
}

export function loadRecoverableBackgroundLaunches(options?: {
  now?: number
  lookbackMs?: number
  limit?: number
}): RecoverableBackgroundLaunch[] {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) {
    return []
  }

  const now = options?.now ?? Date.now()
  const lookbackMs = options?.lookbackMs ?? DEFAULT_RECOVERY_LOOKBACK_MS
  const limit = options?.limit ?? DEFAULT_RECOVERY_LIMIT
  const cutoff = now - lookbackMs

  let db: Database | undefined
  try {
    db = new Database(dbPath)
    db.exec("PRAGMA journal_mode = WAL;")
    db.exec("PRAGMA busy_timeout = 60000;")

    const rows = queryLaunchRows(db, cutoff, limit)

    const launches: RecoverableBackgroundLaunch[] = []
    for (const row of rows) {
      const snapshot = buildSnapshot(db, row)
      if (!snapshot || snapshot.hasParentCompletionNotification) {
        continue
      }
      launches.push(snapshot)
    }

    return launches
  } catch (error) {
    log("[background-agent] Failed to load recoverable background launches:", {
      error: String(error),
    })
    return []
  } finally {
    db?.close()
  }
}
