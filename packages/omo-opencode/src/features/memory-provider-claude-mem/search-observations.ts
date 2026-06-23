import type { Database } from "bun:sqlite"
import type { ClaudeMemSearchItem } from "./types"

export interface SearchObservationsOptions {
  project?: string
  obs_type?: string
  limit?: number
  date_start?: string
}

export function searchObservationsFromDb(
  db: Database,
  query: string,
  options: SearchObservationsOptions = {},
): ClaudeMemSearchItem[] {
  const limit = options.limit ?? 20
  const likePattern = `%${query}%`
  const params: (string | number)[] = [likePattern, likePattern]
  const conditions: string[] = ["(o.title LIKE ? OR o.text LIKE ?)"]

  if (options.project) {
    conditions.push("o.project = ?")
    params.push(options.project)
  }
  if (options.obs_type) {
    const sanitized = options.obs_type
      .split(",")
      .map((t) => t.trim().replace(/'/g, ""))
      .filter((t) => t.length > 0)
    if (sanitized.length > 0) {
      const placeholders = sanitized.map(() => "?").join(",")
      conditions.push(`o.type IN (${placeholders})`)
      params.push(...sanitized)
    }
  }
  if (options.date_start) {
    conditions.push("o.created_at >= ?")
    params.push(options.date_start)
  }

  params.push(limit)
  const rows = db.query(`
    SELECT o.id, o.type, o.title, o.subtitle, o.project, o.discovery_tokens, o.created_at
    FROM observations o
    WHERE ${conditions.join(" AND ")}
    ORDER BY o.created_at DESC
    LIMIT ?
  `).all(...params) as Array<{
    id: number
    type: string
    title: string | null
    subtitle: string | null
    project: string
    discovery_tokens: number | null
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    time: row.created_at,
    type: row.type,
    title: row.title ?? "(untitled)",
    subtitle: row.subtitle ?? undefined,
    project: row.project,
    discovery_tokens: row.discovery_tokens ?? undefined,
  }))
}
