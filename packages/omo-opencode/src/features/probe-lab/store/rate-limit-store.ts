import type { Database } from "bun:sqlite"
import type { NewRateLimitInput, RateLimitObservation } from "../provider-types"

export type RateLimitStore = ReturnType<typeof createRateLimitStore>

const DEFAULT_RETENTION_DAYS = 90

export function createRateLimitStore(db: Database) {
  function insert(input: NewRateLimitInput): RateLimitObservation {
    const result = db.run(
      `INSERT INTO rate_limit_observations
         (identity_id, provider_id, exchange_id, type, http_status, retry_after_s, response_body_preview)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      [
        input.identity_id ?? null,
        input.provider_id ?? null,
        input.exchange_id ?? null,
        input.type,
        input.http_status ?? null,
        input.retry_after_s ?? null,
        input.response_body_preview ?? null,
      ],
    )
    const id = Number(result.lastInsertRowid)
    return db.query<RateLimitObservation, [number]>(
      "SELECT * FROM rate_limit_observations WHERE id = ?1",
    ).get(id)!
  }

  function listForIdentity(identityId: string, limit = 100): RateLimitObservation[] {
    return db.query<RateLimitObservation, [string, number]>(
      "SELECT * FROM rate_limit_observations WHERE identity_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
    ).all(identityId, limit)
  }

  function listForProvider(providerId: string, limit = 100): RateLimitObservation[] {
    return db.query<RateLimitObservation, [string, number]>(
      "SELECT * FROM rate_limit_observations WHERE provider_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
    ).all(providerId, limit)
  }

  function deleteOlderThan(retentionDays = DEFAULT_RETENTION_DAYS): number {
    const result = db.run(
      `DELETE FROM rate_limit_observations WHERE timestamp < unixepoch() - (?1 * 86400)`,
      [retentionDays],
    )
    return Number(result.changes ?? 0)
  }

  function countOlderThan(retentionDays: number): number {
    return db.query<{ count: number }, [number]>(
      `SELECT COUNT(*) as count FROM rate_limit_observations WHERE timestamp < unixepoch() - (?1 * 86400)`,
    ).get(retentionDays)?.count ?? 0
  }

  return { insert, listForIdentity, listForProvider, deleteOlderThan, countOlderThan }
}
