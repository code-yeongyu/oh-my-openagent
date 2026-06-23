import type { Database } from "bun:sqlite"

export type ProbeLabConfigRow = {
  key: string
  value: string
  description: string | null
  updated_at: number
}

export type ProbeLabConfigStore = ReturnType<typeof createProbeLabConfigStore>

export function createProbeLabConfigStore(db: Database) {
  function get(key: string): ProbeLabConfigRow | null {
    return db.query<ProbeLabConfigRow, [string]>(
      "SELECT * FROM probe_lab_config WHERE key = ?1",
    ).get(key) ?? null
  }

  function set(key: string, value: string, description?: string | null): ProbeLabConfigRow {
    db.run(
      `INSERT INTO probe_lab_config (key, value, description)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         description = COALESCE(excluded.description, probe_lab_config.description),
         updated_at = unixepoch()`,
      [key, value, description ?? null],
    )
    return get(key)!
  }

  function list(): ProbeLabConfigRow[] {
    return db.query<ProbeLabConfigRow, []>(
      "SELECT * FROM probe_lab_config ORDER BY key ASC",
    ).all()
  }

  function deleteKey(key: string): boolean {
    const result = db.query("DELETE FROM probe_lab_config WHERE key = ?1").run(key)
    return Number(result.changes ?? 0) > 0
  }

  return { get, set, list, delete: deleteKey }
}
