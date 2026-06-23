import type { Database } from "bun:sqlite"
import type { Capture, NewCaptureInput } from "../pool-types"

export type CaptureStore = ReturnType<typeof createCaptureStore>

export function createCaptureStore(db: Database) {
  function insert(input: NewCaptureInput): Capture {
    db.run(
      `INSERT INTO captures
         (id, session_id, format, file_path, file_size_bytes,
          exchange_count, compressed, checksum_sha256)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      [
        input.id,
        input.session_id,
        input.format,
        input.file_path,
        input.file_size_bytes ?? null,
        input.exchange_count ?? null,
        input.compressed ? 1 : 0,
        input.checksum_sha256 ?? null,
      ],
    )
    return mustGet(input.id)
  }

  function get(id: string): Capture | null {
    return db.query<Capture, [string]>("SELECT * FROM captures WHERE id = ?1").get(id) ?? null
  }

  function mustGet(id: string): Capture {
    const row = get(id)
    if (!row) throw new Error(`capture not found: ${id}`)
    return row
  }

  function listForSession(sessionId: string): Capture[] {
    return db.query<Capture, [string]>(
      "SELECT * FROM captures WHERE session_id = ?1 ORDER BY created_at DESC",
    ).all(sessionId)
  }

  function countOlderThan(cutoffSeconds: number): number {
    return db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM captures WHERE created_at < ?1",
    ).get(cutoffSeconds)?.count ?? 0
  }

  function deleteOlderThan(cutoffSeconds: number): number {
    const result = db.run("DELETE FROM captures WHERE created_at < ?1", [cutoffSeconds])
    return Number(result.changes ?? 0)
  }

  return { insert, get, listForSession, countOlderThan, deleteOlderThan }
}
