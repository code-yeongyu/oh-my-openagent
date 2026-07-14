import type { Database } from "../../db/sqlite"
import { getChunkEmbeddingsBySession } from "../../db/queries/compartments"
import { cosineSimilarity } from "../../embedding/cosine-sim"
import type { SearchQuery, SearchResult, SearchSource } from "../types"

export async function searchCompartment(
  db: Database,
  queryEmbedding: Float32Array,
  query: SearchQuery,
): Promise<SearchResult[]> {
  if (query.sources && !query.sources.includes("compartment" as SearchSource)) return []
  if (!queryEmbedding) return []

  const limit = query.limit ?? 10
  const chunks = getChunkEmbeddingsBySession(db, query.sessionId)
  if (chunks.length === 0) return []

  const scored: Array<{ result: SearchResult; score: number; ordinal: number }> = []

  for (const chunk of chunks) {
    const vector = bytesToFloat32Array(chunk.vector)
    const similarity = cosineSimilarity(queryEmbedding, vector)
    const score = normalizeScore(similarity)
    if (score <= 0) continue

    scored.push({
      score,
      ordinal: chunk.startOrdinal,
      result: {
        id: `compartment:${chunk.compartmentId}`,
        source: "compartment",
        title: `Compartment ${chunk.compartmentId}`,
        content: `chunk ${chunk.windowIndex} (ordinals ${chunk.startOrdinal}–${chunk.endOrdinal})`,
        score,
        metadata: {
          compartmentId: chunk.compartmentId,
          sessionId: chunk.sessionId,
          startOrdinal: chunk.startOrdinal,
          endOrdinal: chunk.endOrdinal,
          modelId: chunk.modelId,
        },
      },
    })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
    .slice(0, limit)
    .map((entry) => entry.result)
}

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.min(1, Math.max(0, score))
}

function bytesToFloat32Array(bytes: Uint8Array): Float32Array {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Float32Array(buffer)
}
