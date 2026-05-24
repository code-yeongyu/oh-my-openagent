import { storeMemory, retrieveMemories } from "./memory"
import type { MemoryEntry, MemoryQuery, MemorySearchResult } from "./types"

const AGENT_SCORE_BOOST = 1.5

export function retrieveAgentMemories(
  agentName: string,
  query: string,
  limit = 5,
): MemorySearchResult[] {
  const q: MemoryQuery = {
    query,
    agentName,
    limit: limit * 2, // Fetch extra for filtering
  }
  const allResults = retrieveMemories(q)

  // Boost agent-specific results
  const scored = allResults.map((r) => ({
    ...r,
    similarity: r.entry.agentName === agentName
      ? r.similarity * AGENT_SCORE_BOOST
      : r.similarity,
  }))

  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

export function storeAgentMemory(
  content: string,
  agentName: string,
  sessionId?: string,
  memoryType: MemoryEntry["memoryType"] = "context",
  importance = 1.0,
): MemoryEntry {
  return storeMemory(content, { agentName, sessionId, memoryType, importance })
}
