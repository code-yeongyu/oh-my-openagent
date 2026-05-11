import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { SearchResult } from "./types"

export interface SQLSearchOptions {
  query: string
  sessionID?: string
  caseSensitive?: boolean
  limit?: number
}

interface SearchRow {
  session_id: string
  session_title: string
  message_id: string
  mtime: number
  data: string
}

export function getDBPath(): string {
  if (process.env.OPENCODE_DB) {
    return process.env.OPENCODE_DB
  }
  return join(homedir(), ".local", "share", "opencode", "opencode.db")
}

function openDB(): Database | null {
  const dbPath = getDBPath()
  if (!existsSync(dbPath)) {
    return null
  }
  try {
    const db = new Database(dbPath, { readonly: true })
    db.run("PRAGMA query_only = ON")
    return db
  } catch {
    return null
  }
}

function termsFor(query: string): string[] {
  const tokens = query.match(/[\w\u4e00-\u9fff-]+/gu)
  if (!tokens || tokens.length === 0) return []
  return Array.from(new Set(tokens.map((t) => t.trim()).filter(Boolean)))
}

function snippetAround(text: string, query: string, contextSize = 80): string {
  let idx = -1
  if (query.length > 0) {
    idx = text.toLowerCase().indexOf(query.toLowerCase())
  }
  if (idx < 0) {
    idx = 0
  }
  const start = Math.max(0, idx - contextSize)
  const end = Math.min(text.length, idx + query.length + contextSize)
  let result = text.slice(start, end)
  if (start > 0) result = "..." + result
  if (end < text.length) result = result + "..."
  return result
}

function executeSQLSearch(
  db: Database,
  terms: string[],
  sessionID: string | undefined,
  caseSensitive: boolean,
  limit: number,
): SearchResult[] {
  const results: SearchResult[] = []
  const seen = new Set<string>()

  function searchColumn(table: string, term: string): void {
    if (results.length >= limit) return

    const whereCol = table === "message" ? "m.data" : "part.data"
    const joinClause = table === "part" ? "JOIN part ON part.message_id = m.id" : ""
    const select = table === "part"
      ? "SELECT DISTINCT s.id as session_id, s.title as session_title, m.id as message_id, m.time_created as mtime, m.data as data"
      : "SELECT s.id as session_id, s.title as session_title, m.id as message_id, m.time_created as mtime, m.data as data"

    const termParam = caseSensitive ? term : term.toLowerCase()
    const instrExpr = caseSensitive
      ? `instr(${whereCol}, ?) > 0`
      : `instr(lower(${whereCol}), ?) > 0`

    let sql = `${select} FROM message m
     JOIN session s ON m.session_id = s.id
     ${joinClause}
     WHERE ${instrExpr}`

    const params: string[] = [termParam]

    if (sessionID) {
      sql += " AND m.session_id = ?"
      params.push(sessionID)
    }

    sql += " ORDER BY m.time_created DESC LIMIT ?"
    params.push(String(limit * 3))

    const rows = db.query(sql).all(...params) as SearchRow[]

    for (const row of rows) {
      if (results.length >= limit) break

      const key = `${row.session_id}:${row.message_id}`
      if (seen.has(key)) continue

      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(row.data || "{}") as Record<string, unknown>
      } catch {
        parsed = {}
      }
      const role = typeof parsed.role === "string" ? parsed.role : "unknown"

      const partRows = db
        .query("SELECT data FROM part WHERE message_id = ? ORDER BY id LIMIT 5")
        .all(row.message_id) as { data: string }[]

      const textParts: string[] = []
      for (const pr of partRows) {
        try {
          const pd = JSON.parse(pr.data || "{}") as Record<string, unknown>
          if (typeof pd.text === "string" && pd.text) {
            textParts.push(pd.text)
          } else if (typeof pd.thinking === "string" && pd.thinking) {
            textParts.push(pd.thinking)
          }
        } catch {
          continue
        }
      }

      const combined = textParts.join(" | ")
      const searchCombined = caseSensitive ? combined : combined.toLowerCase()
      const searchTerm = caseSensitive ? term : term.toLowerCase()
      let matchCount = 0
      const matchTypes: string[] = []
      let searchPos = 0
      while ((searchPos = searchCombined.indexOf(searchTerm, searchPos)) !== -1) {
        matchCount++
        searchPos += searchTerm.length
      }
      if (matchCount > 0) {
        matchTypes.push("text")
      }

      if (matchCount === 0) {
        const dataStr = caseSensitive ? JSON.stringify(parsed) : JSON.stringify(parsed).toLowerCase()
        let p = 0
        while ((p = dataStr.indexOf(searchTerm, p)) !== -1) {
          matchCount++
          p += searchTerm.length
        }
        if (matchCount > 0) {
          matchTypes.push("data")
        }
      }

      if (matchCount === 0) {
        const dataRaw = caseSensitive ? (row.data || "") : (row.data || "").toLowerCase()
        let pr = 0
        while ((pr = dataRaw.indexOf(searchTerm, pr)) !== -1) {
          matchCount++
          pr += searchTerm.length
        }
        if (matchCount > 0 && !matchTypes.includes("data")) {
          matchTypes.push("data")
        }
      }

      const excerpt = combined
        ? snippetAround(combined, term)
        : snippetAround(JSON.stringify(parsed), term, 120)

      seen.add(key)
      results.push({
        session_id: row.session_id || "",
        message_id: row.message_id || "",
        role,
        excerpt,
        match_count: matchCount || 1,
        timestamp: typeof row.mtime === "number" ? row.mtime : undefined,
        match_type: matchTypes.length > 0 ? matchTypes : ["text"],
        source: "sql",
        title: row.session_title || "",
        score: Math.min(1.0, (matchCount || 1) * 0.1),
      })
    }
  }

  for (const term of terms.slice(0, 6)) {
    searchColumn("part", term)
    if (results.length >= limit) break
    searchColumn("message", term)
    if (results.length >= limit) break
  }

  results.sort((a, b) => {
    const scoreDiff = b.score - a.score
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff
    return (b.timestamp ?? 0) - (a.timestamp ?? 0)
  })

  return results.slice(0, limit)
}

export function searchSessionsSQL(
  db: Database,
  options: SQLSearchOptions,
): SearchResult[] {
  const query = options.query.trim()
  if (!query) return []

  const searchTerms = termsFor(query)
  if (searchTerms.length === 0) return []

  const limit = options.limit && options.limit > 0 ? options.limit : 20

  return executeSQLSearch(
    db,
    searchTerms,
    options.sessionID,
    options.caseSensitive ?? false,
    limit,
  )
}

export function searchSessions(
  options: SQLSearchOptions,
): SearchResult[] {
  const db = openDB()
  if (!db) return []
  try {
    return searchSessionsSQL(db, options)
  } finally {
    db.close()
  }
}