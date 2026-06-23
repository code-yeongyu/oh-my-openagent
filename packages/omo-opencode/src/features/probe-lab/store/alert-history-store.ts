import type { Database } from "bun:sqlite"

export type AlertHistoryRow = {
  id: number
  rule_name: string
  severity: string
  message: string
  entity_id: string | null
  fired_at: number
  acknowledged_at: number | null
}

export type NewAlertHistoryInput = {
  rule_name: string
  severity: string
  message: string
  entity_id: string | null
}

export type AlertHistoryStore = ReturnType<typeof createAlertHistoryStore>

export function createAlertHistoryStore(db: Database) {
  function record(input: NewAlertHistoryInput): AlertHistoryRow {
    const result = db.run(
      `INSERT INTO alert_history (rule_name, severity, message, entity_id)
       VALUES (?1, ?2, ?3, ?4)`,
      [input.rule_name, input.severity, input.message, input.entity_id],
    )
    return get(Number(result.lastInsertRowid))!
  }

  function get(id: number): AlertHistoryRow | null {
    return db.query<AlertHistoryRow, [number]>("SELECT * FROM alert_history WHERE id = ?1").get(id) ?? null
  }

  function lastFiredAt(rule: string, entityId: string | null): number | null {
    const row = entityId == null
      ? db.query<{ fired_at: number }, [string]>(
        "SELECT fired_at FROM alert_history WHERE rule_name = ?1 AND entity_id IS NULL ORDER BY fired_at DESC LIMIT 1",
      ).get(rule)
      : db.query<{ fired_at: number }, [string, string]>(
        "SELECT fired_at FROM alert_history WHERE rule_name = ?1 AND entity_id = ?2 ORDER BY fired_at DESC LIMIT 1",
      ).get(rule, entityId)
    return row?.fired_at ?? null
  }

  function listSince(sinceSeconds: number): AlertHistoryRow[] {
    return db.query<AlertHistoryRow, [number]>(
      "SELECT * FROM alert_history WHERE fired_at >= ?1 ORDER BY fired_at DESC",
    ).all(sinceSeconds)
  }

  return { record, get, lastFiredAt, listSince }
}
