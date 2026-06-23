import type { Database } from "bun:sqlite"
import type { ProbeSession } from "../types"

export type SessionStore = ReturnType<typeof createSessionStore>

export type NewSessionInput = {
  id: string
  hypothesis_id: string | null
  identity_id: string | null
  experiment_id?: string | null
  provider_id?: string | null
  config?: unknown
}

export function createSessionStore(db: Database) {
  function insert(input: NewSessionInput): ProbeSession {
    db.run(
      `INSERT INTO probe_sessions (id, hypothesis_id, identity_id, experiment_id, provider_id, config)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      [
        input.id,
        input.hypothesis_id,
        input.identity_id,
        input.experiment_id ?? null,
        input.provider_id ?? null,
        input.config == null ? null : JSON.stringify(input.config),
      ],
    )
    return db.query<ProbeSession, [string]>(
      "SELECT * FROM probe_sessions WHERE id = ?1",
    ).get(input.id)!
  }

  function get(id: string): ProbeSession | null {
    return db.query<ProbeSession, [string]>(
      "SELECT * FROM probe_sessions WHERE id = ?1",
    ).get(id) ?? null
  }

  function findByLabel(label: string): ProbeSession | null {
    return db.query<ProbeSession, [string]>(
      `SELECT * FROM probe_sessions
       WHERE id = ?1
         OR (config IS NOT NULL AND json_extract(config, '$.label') = ?1)
       ORDER BY started_at DESC
       LIMIT 1`,
    ).get(label) ?? null
  }

  function listForExperiment(experimentId: string): ProbeSession[] {
    return db.query<ProbeSession, [string]>(
      "SELECT * FROM probe_sessions WHERE experiment_id = ?1 ORDER BY started_at ASC",
    ).all(experimentId)
  }

  return { insert, get, findByLabel, listForExperiment }
}
