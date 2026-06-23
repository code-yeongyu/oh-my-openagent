import type { Database } from "bun:sqlite"
import type { NewExchangeInput, ProbeExchange } from "../types"

export type ExchangeStore = ReturnType<typeof createExchangeStore>

export function createExchangeStore(db: Database) {
  function insert(input: NewExchangeInput): ProbeExchange {
    const result = db.run(
      `INSERT INTO probe_exchanges
         (session_id, method, url, request_headers, request_body,
          response_status, response_headers, response_body,
          timing_total_ms, was_forwarded_as_is)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      [
        input.session_id,
        input.method,
        input.url,
        input.request_headers ? JSON.stringify(input.request_headers) : null,
        input.request_body ?? null,
        input.response_status ?? null,
        input.response_headers ? JSON.stringify(input.response_headers) : null,
        input.response_body ?? null,
        input.timing_total_ms ?? null,
        input.was_forwarded_as_is ? 1 : 0,
      ],
    )
    const id = Number(result.lastInsertRowid)
    return db.query<ProbeExchange, [number]>(
      "SELECT * FROM probe_exchanges WHERE id = ?1",
    ).get(id)!
  }

  function get(id: number): ProbeExchange | null {
    return db.query<ProbeExchange, [number]>(
      "SELECT * FROM probe_exchanges WHERE id = ?1",
    ).get(id) ?? null
  }

  function listForSession(sessionId: string, limit: number, offset: number): ProbeExchange[] {
    return db.query<ProbeExchange, [string, number, number]>(
      "SELECT * FROM probe_exchanges WHERE session_id = ?1 ORDER BY timestamp ASC LIMIT ?2 OFFSET ?3",
    ).all(sessionId, limit, offset)
  }

  function countForSession(sessionId: string): number {
    return db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM probe_exchanges WHERE session_id = ?1",
    ).get(sessionId)?.count ?? 0
  }

  function listForHypothesis(hypothesisId: string, limit: number, offset: number): ProbeExchange[] {
    return db.query<ProbeExchange, [string, number, number]>(
      `SELECT pe.* FROM probe_exchanges pe
       JOIN evidence e ON e.exchange_id = pe.id
       WHERE e.hypothesis_id = ?1
       ORDER BY pe.timestamp ASC
       LIMIT ?2 OFFSET ?3`,
    ).all(hypothesisId, limit, offset)
  }

  function countForHypothesis(hypothesisId: string): number {
    return db.query<{ count: number }, [string]>(
      `SELECT COUNT(DISTINCT pe.id) as count FROM probe_exchanges pe
       JOIN evidence e ON e.exchange_id = pe.id
       WHERE e.hypothesis_id = ?1`,
    ).get(hypothesisId)?.count ?? 0
  }

  function listByIds(ids: ReadonlyArray<number>): ProbeExchange[] {
    if (ids.length === 0) return []
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(",")
    return db.query<ProbeExchange, number[]>(
      `SELECT * FROM probe_exchanges WHERE id IN (${placeholders}) ORDER BY id ASC`,
    ).all(...ids)
  }

  function countResponseBodiesOlderThan(cutoffSeconds: number): number {
    return db.query<{ count: number }, [number]>(
      "SELECT COUNT(*) as count FROM probe_exchanges WHERE response_body IS NOT NULL AND timestamp < ?1",
    ).get(cutoffSeconds)?.count ?? 0
  }

  function blankResponseBodiesOlderThan(cutoffSeconds: number): number {
    const result = db.run(
      "UPDATE probe_exchanges SET response_body = NULL WHERE response_body IS NOT NULL AND timestamp < ?1",
      [cutoffSeconds],
    )
    return Number(result.changes ?? 0)
  }

  return { insert, get, listForSession, countForSession, listForHypothesis, countForHypothesis, listByIds, countResponseBodiesOlderThan, blankResponseBodiesOlderThan }
}
