import type { Database } from "bun:sqlite"
import type { CanaryLock, NewCanaryLockInput } from "../pool-types"

export type CanaryLockStore = ReturnType<typeof createCanaryLockStore>

export function createCanaryLockStore(db: Database) {
  function insert(input: NewCanaryLockInput): CanaryLock {
    const result = db.run(
      `INSERT INTO canary_locks
         (identity_id, locked_by, lock_reason, canary_test_url,
          canary_test_expected_status, canary_test_interval_s)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      [
        input.identity_id,
        input.locked_by,
        input.lock_reason,
        input.canary_test_url ?? null,
        input.canary_test_expected_status ?? 200,
        input.canary_test_interval_s ?? 60,
      ],
    )
    const id = Number(result.lastInsertRowid)
    return db.query<CanaryLock, [number]>(
      "SELECT * FROM canary_locks WHERE id = ?1",
    ).get(id)!
  }

  function get(id: number): CanaryLock | null {
    return db.query<CanaryLock, [number]>(
      "SELECT * FROM canary_locks WHERE id = ?1",
    ).get(id) ?? null
  }

  function getByIdentity(identityId: string): CanaryLock | null {
    return db.query<CanaryLock, [string]>(
      "SELECT * FROM canary_locks WHERE identity_id = ?1 AND unlocked_at IS NULL",
    ).get(identityId) ?? null
  }

  function release(identityId: string): void {
    db.run(
      "UPDATE canary_locks SET unlocked_at = unixepoch() WHERE identity_id = ?1 AND unlocked_at IS NULL",
      [identityId],
    )
  }

  function recordCanaryResult(identityId: string, result: string): void {
    db.run(
      `UPDATE canary_locks
         SET last_canary_test_at = unixepoch(),
             last_canary_result = ?2
       WHERE identity_id = ?1 AND unlocked_at IS NULL`,
      [identityId, result],
    )
  }

  function listActive(): CanaryLock[] {
    return db.query<CanaryLock, []>(
      "SELECT * FROM canary_locks WHERE unlocked_at IS NULL ORDER BY locked_at DESC",
    ).all()
  }

  return { insert, get, getByIdentity, release, recordCanaryResult, listActive }
}
