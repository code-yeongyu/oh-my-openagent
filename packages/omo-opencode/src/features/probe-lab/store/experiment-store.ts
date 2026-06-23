import type { Database } from "bun:sqlite"
import type { Experiment, ExperimentStatus, NewExperimentInput } from "../experiment-types"

export type ExperimentStore = ReturnType<typeof createExperimentStore>

export function createExperimentStore(db: Database) {
  function insert(input: NewExperimentInput): Experiment {
    db.run(
      `INSERT INTO experiments
         (id, hypothesis_id, question_id, name, description, protocol, expected_outcome, safety_budget)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      [
        input.id,
        input.hypothesis_id,
        input.question_id ?? null,
        input.name,
        input.description ?? null,
        JSON.stringify(input.protocol),
        input.expected_outcome ?? null,
        input.safety_budget ? JSON.stringify(input.safety_budget) : null,
      ],
    )
    return mustGet(input.id)
  }

  function get(id: string): Experiment | null {
    return db.query<Experiment, [string]>("SELECT * FROM experiments WHERE id = ?1").get(id) ?? null
  }

  function mustGet(id: string): Experiment {
    const row = get(id)
    if (!row) throw new Error(`experiment not found: ${id}`)
    return row
  }

  function list(args: {
    hypothesis_id?: string
    status_filter?: ExperimentStatus
    limit: number
    offset: number
  }): { rows: Experiment[]; total: number } {
    const where: string[] = []
    const params: Array<string | number> = []
    let pi = 1
    if (args.hypothesis_id) {
      where.push(`hypothesis_id = ?${pi++}`)
      params.push(args.hypothesis_id)
    }
    if (args.status_filter) {
      where.push(`status = ?${pi++}`)
      params.push(args.status_filter)
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : ""
    const total = db.query<{ count: number }, typeof params>(
      `SELECT COUNT(*) as count FROM experiments ${w}`,
    ).get(...params)?.count ?? 0
    const rows = db.query<Experiment, Array<string | number>>(
      `SELECT * FROM experiments ${w} ORDER BY created_at DESC LIMIT ?${pi++} OFFSET ?${pi++}`,
    ).all(...params, args.limit, args.offset)
    return { rows, total }
  }

  function updateStatus(id: string, status: ExperimentStatus): void {
    const now = Math.floor(Date.now() / 1000)
    const startedAt = status === "running" ? now : null
    const completedAt = status === "completed" || status === "aborted" ? now : null
    db.run(
      `UPDATE experiments
         SET status = ?2,
             started_at = COALESCE(?3, started_at),
             completed_at = COALESCE(?4, completed_at)
       WHERE id = ?1`,
      [id, status, startedAt, completedAt],
    )
  }

  function abort(id: string, reason: string): void {
    db.run(
      `UPDATE experiments
         SET status = 'aborted',
             completed_at = unixepoch(),
             safety_budget = CASE WHEN safety_budget IS NULL THEN json_object('abort_reason', ?2) ELSE json_set(safety_budget, '$.abort_reason', ?2) END
       WHERE id = ?1`,
      [id, reason],
    )
  }

  return { insert, get, list, updateStatus, abort }
}
