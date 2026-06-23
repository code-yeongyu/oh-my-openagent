import type { Database } from "bun:sqlite"
import type { AuditLogEntry, AuditLogFilters, NewAuditLogInput } from "../audit-log-types"

export type AuditLogStore = ReturnType<typeof createAuditLogStore>

export function createAuditLogStore(db: Database) {
  function insert(input: NewAuditLogInput): AuditLogEntry {
    const result = db.run(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, reason, session_context)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      [
        input.entity_type,
        input.entity_id,
        input.action,
        input.actor ?? "system",
        input.changes == null ? null : JSON.stringify(input.changes),
        input.reason ?? null,
        input.session_context == null ? null : JSON.stringify(input.session_context),
      ],
    )
    return get(Number(result.lastInsertRowid))!
  }

  function get(id: number): AuditLogEntry | null {
    return db.query<AuditLogEntry, [number]>("SELECT * FROM audit_log WHERE id = ?1").get(id) ?? null
  }

  function list(args: AuditLogFilters & { limit: number; offset: number }): { entries: AuditLogEntry[]; total: number } {
    const built = buildWhere(args)
    const total = db.query<{ count: number }, Array<string | number>>(
      `SELECT COUNT(*) as count FROM audit_log ${built.where}`,
    ).get(...built.params)?.count ?? 0
    const entries = db.query<AuditLogEntry, Array<string | number>>(
      `SELECT * FROM audit_log ${built.where} ORDER BY created_at DESC, id DESC LIMIT ?${built.next} OFFSET ?${built.next + 1}`,
    ).all(...built.params, args.limit, args.offset)
    return { entries, total }
  }

  function count(filters: AuditLogFilters): number {
    const built = buildWhere(filters)
    return db.query<{ count: number }, Array<string | number>>(
      `SELECT COUNT(*) as count FROM audit_log ${built.where}`,
    ).get(...built.params)?.count ?? 0
  }

  function countOlderThan(cutoffSeconds: number): number {
    return db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM audit_log WHERE created_at < ?1",
    ).get(cutoffSeconds)?.count ?? 0
  }

  function deleteOlderThan(cutoffSeconds: number): number {
    const result = db.run("DELETE FROM audit_log WHERE created_at < ?1", [cutoffSeconds])
    return Number(result.changes ?? 0)
  }

  return { insert, get, list, count, countOlderThan, deleteOlderThan }
}

function buildWhere(filters: AuditLogFilters): { where: string; params: Array<string | number>; next: number } {
  const clauses: string[] = []
  const params: Array<string | number> = []
  let next = 1
  for (const [column, value] of exactFilters(filters)) {
    if (value == null) continue
    clauses.push(`${column} = ?${next++}`)
    params.push(value)
  }
  if (filters.since != null) {
    clauses.push(`created_at >= ?${next++}`)
    params.push(filters.since)
  }
  if (filters.until != null) {
    clauses.push(`created_at <= ?${next++}`)
    params.push(filters.until)
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params, next }
}

function exactFilters(filters: AuditLogFilters): ReadonlyArray<[string, string | undefined]> {
  return [
    ["entity_type", filters.entity_type],
    ["entity_id", filters.entity_id],
    ["action", filters.action],
  ]
}
