import type { Database } from "../../db/sqlite"
import { cosineSimilarity } from "../../embedding/cosine-sim"
import type { SearchQuery, SearchResult, SearchSource } from "../types"

interface CommitEmbeddingRow {
  sha: string
  short_sha: string
  message: string
  author: string | null
  committed_at: number
  embedding: Uint8Array
}

export async function searchCommit(
  db: Database,
  queryEmbedding: Float32Array,
  query: SearchQuery,
): Promise<SearchResult[]> {
  if (query.sources && !query.sources.includes("commit" as SearchSource)) return []

  const limit = query.limit ?? 10
  const results: SearchResult[] = []
  const seenShas = new Set<string>()

  if (query.useFts !== false) {
    const ftsHits = searchCommitsFts(db, query.projectPath, query.text, limit * 3)
    for (const hit of ftsHits) {
      seenShas.add(hit.sha)
      results.push({
        id: `commit:${hit.sha}`,
        source: "commit",
        title: hit.shortSha,
        content: hit.message,
        score: hit.score,
        metadata: {
          sha: hit.sha,
          shortSha: hit.shortSha,
          author: hit.author,
          committedAtMs: hit.committedAtMs,
          matchType: "fts",
        },
      })
    }
  }

  if (queryEmbedding && queryEmbedding.length > 0 && query.semanticOnly !== true) {
    const rows = db
      .prepare(
        `SELECT c.sha, c.short_sha, c.message, c.author, c.committed_at, e.embedding AS embedding
         FROM git_commits c
         INNER JOIN git_commit_embeddings e ON e.sha = c.sha
         WHERE c.project_path = ?
         ORDER BY c.committed_at DESC`,
      )
      .all(query.projectPath) as CommitEmbeddingRow[]

    for (const row of rows) {
      if (seenShas.has(row.sha)) continue
      const emb = row.embedding
      const float32 = new Float32Array(emb.buffer.slice(emb.byteOffset, emb.byteOffset + emb.byteLength))
      const similarity = cosineSimilarity(queryEmbedding, float32)
      const score = normalizeScore(similarity)
      if (score <= 0) continue

      seenShas.add(row.sha)
      results.push({
        id: `commit:${row.sha}`,
        source: "commit",
        title: row.short_sha,
        content: row.message,
        score,
        metadata: {
          sha: row.sha,
          shortSha: row.short_sha,
          author: row.author,
          committedAtMs: row.committed_at,
          matchType: "semantic",
        },
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function searchCommitsFts(
  db: Database,
  projectPath: string,
  query: string,
  limit: number,
): Array<{ sha: string; shortSha: string; message: string; author: string | null; committedAtMs: number; score: number }> {
  const sanitized = sanitizeFtsQuery(query)
  if (sanitized.length === 0) return []

  try {
    const rows = db
      .prepare(
        `SELECT c.sha, c.short_sha, c.message, c.author, c.committed_at
         FROM git_commits_fts
         INNER JOIN git_commits c ON c.sha = git_commits_fts.sha
         WHERE c.project_path = ? AND git_commits_fts MATCH ?
         ORDER BY bm25(git_commits_fts) LIMIT ?`,
      )
      .all(projectPath, sanitized, limit) as Array<{
      sha: string
      short_sha: string
      message: string
      author: string | null
      committed_at: number
    }>

    return rows.map((row, rank) => ({
      sha: row.sha,
      shortSha: row.short_sha,
      message: row.message,
      author: row.author,
      committedAtMs: row.committed_at,
      score: 1 / (rank + 1),
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

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.min(1, Math.max(0, score))
}
