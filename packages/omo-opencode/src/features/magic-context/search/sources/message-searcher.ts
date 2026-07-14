import type { Database } from "../../db/sqlite"
import type { SearchQuery, SearchResult, SearchSource } from "../types"

export async function searchMessage(
  db: Database,
  _queryEmbedding: Float32Array,
  query: SearchQuery,
): Promise<SearchResult[]> {
  if (query.sources && !query.sources.includes("message" as SearchSource)) return []
  if (query.text.trim().length === 0) return []

  const limit = query.limit ?? 10
  const sanitized = sanitizeFtsQuery(query.text.trim())
  if (sanitized.length === 0) return []

  try {
    const rows = db
      .prepare(
        `SELECT message_id, message_ordinal, role, content
         FROM message_history_fts
         WHERE session_id = ? AND message_history_fts MATCH ?
         ORDER BY bm25(message_history_fts), CAST(message_ordinal AS INTEGER) ASC
         LIMIT ?`,
      )
      .all(query.sessionId, sanitized, limit) as Array<{
      message_id: string
      message_ordinal: number
      role: string
      content: string
    }>

    return rows.map((row, rank) => ({
      id: `message:${row.message_id}`,
      source: "message" as const,
      title: `${row.role} #${row.message_ordinal}`,
      content: previewText(row.content),
      score: linearDecayScore(rank, rows.length),
      metadata: {
        messageOrdinal: row.message_ordinal,
        messageId: row.message_id,
        role: row.role,
      },
    }))
  } catch {
    return []
  }
}

function sanitizeFtsQuery(query: string): string {
  const tokens = query.split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 0) return ""
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ")
}

function linearDecayScore(rank: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, 1 - rank / total)
}

const RESULT_PREVIEW_LIMIT = 220

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= RESULT_PREVIEW_LIMIT) return normalized
  return `${normalized.slice(0, RESULT_PREVIEW_LIMIT - 1).trimEnd()}…`
}
