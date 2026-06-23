import type { Database } from "bun:sqlite"
import type { CircuitState, Identity, IdentityStatus, NewIdentityInput, PoolHealth } from "../types"
import { decryptIdentityRow, encryptIdentityConfig } from "./identity-row-codec"
import {
  migrateLegacyFingerprintInline,
  readIncomingFingerprintProfileId,
  stripFingerprintFromConfig,
} from "./identity-config-migrator"

export type IdentityStore = ReturnType<typeof createIdentityStore>

export function createIdentityStore(db: Database) {
  function upsert(input: NewIdentityInput): Identity {
    const fingerprintProfileId = readIncomingFingerprintProfileId(input)
    db.run(
      `INSERT INTO identities (id, kind, label, config, status, provider_id, tier, fingerprint_profile_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          config = excluded.config,
          status = excluded.status,
          provider_id = excluded.provider_id,
          tier = excluded.tier,
          fingerprint_profile_id = COALESCE(excluded.fingerprint_profile_id, identities.fingerprint_profile_id)`,
      [
        input.id,
        input.kind,
        input.label ?? null,
        encryptIdentityConfig(stripFingerprintFromConfig(input.config)),
        input.status ?? "active",
        input.provider_id ?? null,
        input.tier ?? "standard",
        fingerprintProfileId,
      ],
    )
    return mustGet(input.id)
  }

  function setFingerprintProfileId(id: string, fingerprintProfileId: string | null): void {
    db.run(
      "UPDATE identities SET fingerprint_profile_id = ?2 WHERE id = ?1",
      [id, fingerprintProfileId],
    )
  }

  function get(id: string): Identity | null {
    const row = decryptIdentityRow(db.query<Identity, [string]>(
      "SELECT * FROM identities WHERE id = ?1",
    ).get(id) ?? null)
    return migrateLegacyFingerprintInline(db, row)
  }

  function mustGet(id: string): Identity {
    const row = get(id)
    if (!row) throw new Error(`identity not found: ${id}`)
    return row
  }

  function findFirstActive(): Identity | null {
    db.run(
      `UPDATE identities
         SET status = 'active',
             circuit_state = 'half_open',
             quarantined_until = NULL,
             consecutive_failures = 0
       WHERE status = 'quarantined'
         AND quarantined_until IS NOT NULL
         AND quarantined_until <= unixepoch()`,
    )
    return decryptIdentityRow(db.query<Identity, []>(
      `SELECT * FROM identities
       WHERE status = 'active'
         AND (quarantined_until IS NULL OR quarantined_until <= unixepoch())
         AND NOT (circuit_state = 'open' AND quarantined_until IS NOT NULL AND quarantined_until > unixepoch())
       ORDER BY total_uses ASC, last_used_at ASC NULLS FIRST
       LIMIT 1`,
    ).get() ?? null)
  }

  function promoteExpired(): number {
    const result = db.query(
      `UPDATE identities
         SET status = 'active',
             circuit_state = 'half_open',
             quarantined_until = NULL,
             consecutive_failures = 0
       WHERE status = 'quarantined'
         AND quarantined_until IS NOT NULL
         AND quarantined_until <= unixepoch()`,
    ).run()
    return Number(result.changes ?? 0)
  }

  function recordUse(id: string, atSeconds: number): void {
    db.run(
      "UPDATE identities SET total_uses = total_uses + 1, last_used_at = ?2 WHERE id = ?1",
      [id, atSeconds],
    )
  }

  function setCircuitState(args: {
    id: string
    state: CircuitState
    consecutiveFailures: number
    lastFailureAt: number | null
    quarantinedUntil: number | null
    status?: IdentityStatus
  }): void {
    db.run(
      `UPDATE identities
         SET circuit_state = ?2,
             consecutive_failures = ?3,
             last_failure_at = ?4,
             quarantined_until = ?5,
             status = COALESCE(?6, status)
       WHERE id = ?1`,
      [
        args.id,
        args.state,
        args.consecutiveFailures,
        args.lastFailureAt,
        args.quarantinedUntil,
        args.status ?? null,
      ],
    )
  }

  function setTier(id: string, tier: string): void {
    db.run("UPDATE identities SET tier = ?2 WHERE id = ?1", [id, tier])
  }

  function promoteCanaries(count: number): number {
    const result = db.query(
      `UPDATE identities
         SET tier = 'canary'
       WHERE id IN (
         SELECT id FROM identities
         WHERE status = 'active' AND COALESCE(tier, 'standard') != 'canary'
         ORDER BY total_uses ASC, last_used_at ASC NULLS FIRST
         LIMIT ?1
       )`,
    ).run(count)
    return Number(result.changes ?? 0)
  }

  function listByTier(tier: string): Identity[] {
    return db.query<Identity, [string]>(
      "SELECT * FROM identities WHERE tier = ?1 ORDER BY total_uses ASC, id ASC",
    ).all(tier).map((row) => decryptIdentityRow(row)!)
  }

  function countActiveHealthyCanaries(): number {
    const row = db.query<{ total: number }, []>(
      `SELECT COUNT(*) AS total
       FROM identities
       WHERE tier = 'canary'
         AND status = 'active'
         AND circuit_state IN ('closed', 'half_open')
         AND (quarantined_until IS NULL OR quarantined_until <= unixepoch())`,
    ).get()
    return row?.total ?? 0
  }

  function getPoolHealth(): PoolHealth {
    const row = db.query<{
      total: number
      active: number
      quarantined: number
      exhausted: number
    }, []>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'quarantined' THEN 1 ELSE 0 END) AS quarantined,
         SUM(CASE WHEN status = 'exhausted' THEN 1 ELSE 0 END) AS exhausted
       FROM identities`,
    ).get() ?? { total: 0, active: 0, quarantined: 0, exhausted: 0 }
    const total = row.total ?? 0
    const quarantined = row.quarantined ?? 0
    return {
      total,
      active: row.active ?? 0,
      quarantined,
      exhausted: row.exhausted ?? 0,
      quarantined_ratio: total > 0 ? quarantined / total : 0,
    }
  }

  return { upsert, get, findFirstActive, promoteExpired, recordUse, setCircuitState, setTier, promoteCanaries, listByTier, countActiveHealthyCanaries, getPoolHealth, setFingerprintProfileId }
}
