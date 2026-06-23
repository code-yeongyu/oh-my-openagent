import type { Database } from "bun:sqlite"
import type { NewPoolSnapshotInput, PoolSnapshot } from "../pool-types"

export type PoolSnapshotStore = ReturnType<typeof createPoolSnapshotStore>

export function createPoolSnapshotStore(db: Database) {
  function insert(input: NewPoolSnapshotInput): PoolSnapshot {
    db.run(
      `INSERT INTO pool_snapshots
         (id, experiment_id, session_id, triggered_by, snapshot_data,
          total_identities, active_count, canary_count, quarantined_count,
          exhausted_count, healthy_ratio)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      [
        input.id,
        input.experiment_id ?? null,
        input.session_id ?? null,
        input.triggered_by,
        JSON.stringify(input.snapshot_data),
        input.total_identities ?? null,
        input.active_count ?? null,
        input.canary_count ?? null,
        input.quarantined_count ?? null,
        input.exhausted_count ?? null,
        input.healthy_ratio ?? null,
      ],
    )
    return mustGet(input.id)
  }

  function get(id: string): PoolSnapshot | null {
    return db.query<PoolSnapshot, [string]>(
      "SELECT * FROM pool_snapshots WHERE id = ?1",
    ).get(id) ?? null
  }

  function mustGet(id: string): PoolSnapshot {
    const row = get(id)
    if (!row) throw new Error(`pool snapshot not found: ${id}`)
    return row
  }

  function listForExperiment(experimentId: string): PoolSnapshot[] {
    return db.query<PoolSnapshot, [string]>(
      "SELECT * FROM pool_snapshots WHERE experiment_id = ?1 ORDER BY created_at DESC",
    ).all(experimentId)
  }

  return { insert, get, listForExperiment }
}
