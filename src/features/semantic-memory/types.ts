export interface MemoryEntry {
  id: string
  content: string
  embedding: number[]
  agentName?: string
  sessionId?: string
  memoryType: "context" | "decision" | "error" | "pattern" | "insight"
  importance: number
  createdAt: Date
  accessedAt?: Date
  accessCount: number
}

export interface MemorySearchResult {
  entry: MemoryEntry
  similarity: number
}

export interface MemoryQuery {
  query: string
  agentName?: string
  memoryType?: MemoryEntry["memoryType"]
  limit?: number
  minImportance?: number
  sessionId?: string
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}
