/**
 * CRUD for session_meta table.
 *
 * Ported from MC's storage-meta-session.ts and storage-meta-shared.ts.
 */

import type { Database } from "../sqlite"

export interface SessionMeta {
  sessionId: string
  lastResponseTime: number
  cacheTtl: string
  counter: number
  lastNudgeTokens: number
  lastNudgeBand: string | null
  lastTransformError: string | null
  isSubagent: boolean
  lastContextPercentage: number
  lastInputTokens: number
  observedSafeInputTokens: number
  cacheAlertSent: boolean
  timesExecuteThresholdReached: number
  compartmentInProgress: boolean
  systemPromptHash: string
  newWorkTokens: number
  totalInputTokens: number
  lastTodoState: string
  cachedM0Bytes: Buffer | null
  cachedM1Bytes: Buffer | null
  lastObservedModelKey: string | null
  lastUsageContextLimit: number
  priorBoundaryOrdinal: number
}

interface SessionMetaRow {
  session_id: string
  last_response_time: number | null
  cache_ttl: string | null
  counter: number | null
  last_nudge_tokens: number | null
  last_nudge_band: string | null
  last_transform_error: string | null
  is_subagent: number | null
  last_context_percentage: number | null
  last_input_tokens: number | null
  observed_safe_input_tokens: number | null
  cache_alert_sent: number | null
  times_execute_threshold_reached: number | null
  compartment_in_progress: number | null
  system_prompt_hash: string | null
  new_work_tokens: number | null
  total_input_tokens: number | null
  last_todo_state: string | null
  cached_m0_bytes: Buffer | Uint8Array | null
  cached_m1_bytes: Buffer | Uint8Array | null
  last_observed_model_key: string | null
  last_usage_context_limit: number | null
  prior_boundary_ordinal: number | null
}

function isSessionMetaRow(row: unknown): row is SessionMetaRow {
  if (row === null || typeof row !== "object") return false
  const r = row as Record<string, unknown>
  return typeof r.session_id === "string"
}

function toSessionMeta(row: SessionMetaRow): SessionMeta {
  const numOr = (v: unknown, d: number): number =>
    typeof v === "number" ? v : d
  return {
    sessionId: row.session_id,
    lastResponseTime: numOr(row.last_response_time, 0),
    cacheTtl:
      typeof row.cache_ttl === "string" && row.cache_ttl.length > 0
        ? row.cache_ttl
        : "5m",
    counter: numOr(row.counter, 0),
    lastNudgeTokens: numOr(row.last_nudge_tokens, 0),
    lastNudgeBand:
      typeof row.last_nudge_band === "string" && row.last_nudge_band.length > 0
        ? row.last_nudge_band
        : null,
    lastTransformError:
      typeof row.last_transform_error === "string" &&
      row.last_transform_error.length > 0
        ? row.last_transform_error
        : null,
    isSubagent: row.is_subagent === 1,
    lastContextPercentage: numOr(row.last_context_percentage, 0),
    lastInputTokens: numOr(row.last_input_tokens, 0),
    observedSafeInputTokens: numOr(row.observed_safe_input_tokens, 0),
    cacheAlertSent: row.cache_alert_sent === 1,
    timesExecuteThresholdReached: numOr(
      row.times_execute_threshold_reached,
      0,
    ),
    compartmentInProgress: row.compartment_in_progress === 1,
    systemPromptHash:
      typeof row.system_prompt_hash === "string"
        ? row.system_prompt_hash
        : "",
    newWorkTokens: numOr(row.new_work_tokens, 0),
    totalInputTokens: numOr(row.total_input_tokens, 0),
    lastTodoState:
      typeof row.last_todo_state === "string" ? row.last_todo_state : "",
    cachedM0Bytes: toBufferOrNull(row.cached_m0_bytes),
    cachedM1Bytes: toBufferOrNull(row.cached_m1_bytes),
    lastObservedModelKey:
      typeof row.last_observed_model_key === "string"
        ? row.last_observed_model_key
        : null,
    lastUsageContextLimit: numOr(row.last_usage_context_limit, 0),
    priorBoundaryOrdinal: Math.max(
      1,
      numOr(row.prior_boundary_ordinal, 1),
    ),
  }
}

function toBufferOrNull(
  v: Buffer | Uint8Array | null,
): Buffer | null {
  if (v === null) return null
  if (Buffer.isBuffer(v)) return v
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function getOrCreateSessionMeta(
  db: Database,
  sessionId: string,
): SessionMeta {
  const result = db
    .prepare("SELECT * FROM session_meta WHERE session_id = ?")
    .get(sessionId)

  if (isSessionMetaRow(result)) {
    return toSessionMeta(result)
  }

  ensureSessionMetaRow(db, sessionId)
  return getDefaultSessionMeta(sessionId)
}

export function updateSessionMeta(
  db: Database,
  sessionId: string,
  updates: Partial<SessionMeta>,
): void {
  const setClauses: string[] = []
  const values: Array<string | number | Buffer | null> = []

  const META_COLUMNS: Record<string, string> = {
    lastResponseTime: "last_response_time",
    cacheTtl: "cache_ttl",
    counter: "counter",
    lastNudgeTokens: "last_nudge_tokens",
    lastNudgeBand: "last_nudge_band",
    lastTransformError: "last_transform_error",
    isSubagent: "is_subagent",
    lastContextPercentage: "last_context_percentage",
    lastInputTokens: "last_input_tokens",
    observedSafeInputTokens: "observed_safe_input_tokens",
    cacheAlertSent: "cache_alert_sent",
    timesExecuteThresholdReached: "times_execute_threshold_reached",
    compartmentInProgress: "compartment_in_progress",
    systemPromptHash: "system_prompt_hash",
    newWorkTokens: "new_work_tokens",
    totalInputTokens: "total_input_tokens",
    lastTodoState: "last_todo_state",
    cachedM0Bytes: "cached_m0_bytes",
    cachedM1Bytes: "cached_m1_bytes",
    lastObservedModelKey: "last_observed_model_key",
    lastUsageContextLimit: "last_usage_context_limit",
    priorBoundaryOrdinal: "prior_boundary_ordinal",
  }

  for (const [key, column] of Object.entries(META_COLUMNS)) {
    const value = updates[key as keyof SessionMeta]
    if (value === undefined) continue

    if (value === null) {
      setClauses.push(`${column} = ?`)
      values.push(null)
    } else if (
      (key === "cachedM0Bytes" || key === "cachedM1Bytes") &&
      value instanceof Uint8Array
    ) {
      setClauses.push(`${column} = ?`)
      values.push(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      )
    } else if (key === "isSubagent" || key === "cacheAlertSent" || key === "compartmentInProgress") {
      setClauses.push(`${column} = ?`)
      values.push(value ? 1 : 0)
    } else if (typeof value === "string" || typeof value === "number") {
      setClauses.push(`${column} = ?`)
      values.push(value)
    }
  }

  if (setClauses.length === 0) return

  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId)
    db.prepare(
      `UPDATE session_meta SET ${setClauses.join(", ")} WHERE session_id = ?`,
    ).run(...values, sessionId)
  })()
}

function ensureSessionMetaRow(
  db: Database,
  sessionId: string,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO session_meta (session_id, harness) VALUES (?, 'opencode')",
  ).run(sessionId)
}

function getDefaultSessionMeta(sessionId: string): SessionMeta {
  return {
    sessionId,
    lastResponseTime: 0,
    cacheTtl: "5m",
    counter: 0,
    lastNudgeTokens: 0,
    lastNudgeBand: null,
    lastTransformError: null,
    isSubagent: false,
    lastContextPercentage: 0,
    lastInputTokens: 0,
    observedSafeInputTokens: 0,
    cacheAlertSent: false,
    timesExecuteThresholdReached: 0,
    compartmentInProgress: false,
    systemPromptHash: "",
    newWorkTokens: 0,
    totalInputTokens: 0,
    lastTodoState: "",
    cachedM0Bytes: null,
    cachedM1Bytes: null,
    lastObservedModelKey: null,
    lastUsageContextLimit: 0,
    priorBoundaryOrdinal: 1,
  }
}

export function deleteSessionMeta(
  db: Database,
  sessionId: string,
): void {
  db.prepare("DELETE FROM session_meta WHERE session_id = ?").run(
    sessionId,
  )
}

export function listAllSessions(db: Database): string[] {
  const rows = db
    .prepare("SELECT session_id FROM session_meta ORDER BY session_id")
    .all() as { session_id: string }[]
  return rows.map((r) => r.session_id)
}
