import type { Database } from "bun:sqlite"
import type { Hypothesis, HypothesisStatus, NewHypothesisInput } from "../types"

export type HypothesisStore = ReturnType<typeof createHypothesisStore>

export function createHypothesisStore(db: Database) {
  function insert(input: NewHypothesisInput): Hypothesis {
    const template = input.aspic_theory_template == null
      ? null
      : JSON.stringify(input.aspic_theory_template)
    db.run(
      `INSERT INTO hypotheses (id, text, falsifiability_criteria, aspic_theory_template)
       VALUES (?1, ?2, ?3, ?4)`,
      [input.id, input.text, input.falsifiability_criteria, template],
    )
    return mustGet(input.id)
  }

  function get(id: string): Hypothesis | null {
    return db.query<Hypothesis, [string]>(
      "SELECT * FROM hypotheses WHERE id = ?1",
    ).get(id) ?? null
  }

  function mustGet(id: string): Hypothesis {
    const row = get(id)
    if (!row) throw new Error(`hypothesis not found: ${id}`)
    return row
  }

  function list(args: {
    status_filter?: HypothesisStatus
    limit: number
    offset: number
  }): { rows: Array<Hypothesis & { evidence_count: number }>; total: number } {
    if (args.status_filter) {
      const total = db.query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM hypotheses WHERE status = ?1",
      ).get(args.status_filter)?.count ?? 0
      const rows = db.query<Hypothesis & { evidence_count: number }, [string, number, number]>(
        `SELECT h.*, (SELECT COUNT(*) FROM evidence e WHERE e.hypothesis_id = h.id) AS evidence_count
         FROM hypotheses h
         WHERE h.status = ?1
         ORDER BY h.updated_at DESC
         LIMIT ?2 OFFSET ?3`,
      ).all(args.status_filter, args.limit, args.offset)
      return { rows, total }
    }
    const total = db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM hypotheses",
    ).get()?.count ?? 0
    const rows = db.query<Hypothesis & { evidence_count: number }, [number, number]>(
      `SELECT h.*, (SELECT COUNT(*) FROM evidence e WHERE e.hypothesis_id = h.id) AS evidence_count
       FROM hypotheses h
       ORDER BY h.updated_at DESC
       LIMIT ?1 OFFSET ?2`,
    ).all(args.limit, args.offset)
    return { rows, total }
  }

  function updateStatus(id: string, status: HypothesisStatus, confidence: number): void {
    db.run(
      `UPDATE hypotheses
         SET status = ?2, confidence = ?3, updated_at = unixepoch()
       WHERE id = ?1`,
      [id, status, confidence],
    )
  }

  function setSupersededBy(id: string, supersededBy: string): void {
    db.run(
      `UPDATE hypotheses
         SET status = 'superseded', superseded_by = ?2, updated_at = unixepoch()
       WHERE id = ?1`,
      [id, supersededBy],
    )
  }

  function setResurrected(id: string, resurrectedFrom: string): void {
    db.run(
      `UPDATE hypotheses
         SET status = 'resurrected', resurrected_from = ?2, updated_at = unixepoch()
       WHERE id = ?1`,
      [id, resurrectedFrom],
    )
  }

  function setUncertaintyLabel(id: string, label: string): void {
    db.run(
      `UPDATE hypotheses SET uncertainty_label = ?2, updated_at = unixepoch() WHERE id = ?1`,
      [id, label],
    )
  }

  return { insert, get, list, updateStatus, setSupersededBy, setResurrected, setUncertaintyLabel }
}
