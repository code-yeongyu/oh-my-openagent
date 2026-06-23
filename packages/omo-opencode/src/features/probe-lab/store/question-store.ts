import type { Database } from "bun:sqlite"
import type { NewQuestionInput, Question, QuestionStatus } from "../experiment-types"

export type QuestionStore = ReturnType<typeof createQuestionStore>

export function createQuestionStore(db: Database) {
  function insert(input: NewQuestionInput): Question {
    db.run(
      `INSERT INTO questions (id, text, domain, priority, tags)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
      [
        input.id,
        input.text,
        input.domain ?? "general",
        input.priority ?? 3,
        input.tags ? JSON.stringify(input.tags) : null,
      ],
    )
    return mustGet(input.id)
  }

  function get(id: string): Question | null {
    return db.query<Question, [string]>("SELECT * FROM questions WHERE id = ?1").get(id) ?? null
  }

  function mustGet(id: string): Question {
    const row = get(id)
    if (!row) throw new Error(`question not found: ${id}`)
    return row
  }

  function list(args: {
    status_filter?: QuestionStatus
    domain?: string
    limit: number
    offset: number
  }): { rows: Question[]; total: number } {
    const where: string[] = []
    const params: Array<string | number> = []
    let pi = 1
    if (args.status_filter) {
      where.push(`status = ?${pi++}`)
      params.push(args.status_filter)
    }
    if (args.domain) {
      where.push(`domain = ?${pi++}`)
      params.push(args.domain)
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""
    const total = db.query<{ count: number }, typeof params>(
      `SELECT COUNT(*) as count FROM questions ${whereClause}`,
    ).get(...params)?.count ?? 0
    const rows = db.query<Question, Array<string | number>>(
      `SELECT * FROM questions ${whereClause} ORDER BY priority ASC, updated_at DESC LIMIT ?${pi++} OFFSET ?${pi++}`,
    ).all(...params, args.limit, args.offset)
    return { rows, total }
  }

  function updateStatus(id: string, status: QuestionStatus): void {
    const ans = status === "answered" ? Math.floor(Date.now() / 1000) : null
    db.run(
      `UPDATE questions SET status = ?2, updated_at = unixepoch(), answered_at = COALESCE(?3, answered_at) WHERE id = ?1`,
      [id, status, ans],
    )
  }

  function park(id: string, reason: string): void {
    db.run(
      `UPDATE questions SET status = 'parked', updated_at = unixepoch(), tags = CASE WHEN tags IS NULL THEN json_array(?2) ELSE json_insert(tags, '$[#]', ?2) END WHERE id = ?1`,
      [id, `park-reason:${reason}`],
    )
  }

  return { insert, get, list, updateStatus, park }
}
