// memory-context-injector removed — the live hook is in src/hooks/semantic-memory.ts
export type { MemoryEntry, MemoryQuery, MemorySearchResult } from "./types"
export { cosineSimilarity } from "./types"
export { generateEmbedding } from "./embeddings"
export {
  storeMemory,
  retrieveMemories,
  getRecentMemories,
  deleteMemory,
  clearAllMemories,
  getMemoryStats,
} from "./memory"
export { getMemoryDb, closeMemoryDb } from "./storage"
