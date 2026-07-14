import type { Database } from "../../db/sqlite"
import { cosineSimilarity } from "../../embedding/cosine-sim"
import type { SearchQuery, SearchResult, SearchSource } from "../types"

interface MemoryEmbeddingRow {
  id: number
  content: string
  category: string
  status: string
  embedding: Uint8Array
}

export async function searchMemory(
  db: Database,
  queryEmbedding: Float32Array,
  query: SearchQuery,
): Promise<SearchResult[]> {
  if (query.sources && !query.sources.includes("memory" as SearchSource)) return []
  if (!queryEmbedding || queryEmbedding.length === 0) return []

  const limit = query.limit ?? 10

  const rows = db
    .prepare(
      `SELECT m.id, m.content, m.category, m.status, me.embedding AS embedding
       FROM memories m
       INNER JOIN memory_embeddings me ON me.memory_id = m.id
       WHERE m.project_path = ? AND m.status IN ('active', 'permanent')
       ORDER BY m.id ASC`,
    )
    .all(query.projectPath) as MemoryEmbeddingRow[]

  if (rows.length === 0) return []

  const scored: Array<{ result: SearchResult; score: number }> = []

  for (const row of rows) {
    const emb = row.embedding
    const float32 = new Float32Array(emb.buffer.slice(emb.byteOffset, emb.byteOffset + emb.byteLength))
    const similarity = cosineSimilarity(queryEmbedding, float32)
    const score = normalizeScore(similarity)
    if (score <= 0) continue

    scored.push({
      score,
      result: {
        id: `memory:${row.id}`,
        source: "memory",
        title: row.category,
        content: row.content,
        score,
        metadata: {
          memoryId: row.id,
          category: row.category,
          status: row.status,
        },
      },
    })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.result)
}

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.min(1, Math.max(0, score))
}
