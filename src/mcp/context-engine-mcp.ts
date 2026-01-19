/**
 * Context-Engine MCP configurations for semantic code search and memory.
 * 
 * Two separate MCPs:
 * - Indexer (8003): Code indexing, symbol graphs, semantic search
 * - Memory (8002): Persistent memory, context storage
 * 
 * ENABLED BY DEFAULT: Assumes context-engine services are running.
 * Disable via environment variable if not using context-engine.
 * 
 * Environment variables:
 * - CONTEXT_ENGINE_INDEXER_URL: Override indexer URL (default: http://localhost:8003/mcp)
 * - CONTEXT_ENGINE_MEMORY_URL: Override memory URL (default: http://localhost:8002/mcp)
 * - CONTEXT_ENGINE_DISABLED: Set to "true" to disable (default: false)
 */
export const context_engine_indexer_mcp = {
  type: "remote" as const,
  url: process.env.CONTEXT_ENGINE_INDEXER_URL ?? "http://localhost:8003/mcp",
  enabled: process.env.CONTEXT_ENGINE_DISABLED !== "true",
  oauth: false as const,
}

export const context_engine_memory_mcp = {
  type: "remote" as const,
  url: process.env.CONTEXT_ENGINE_MEMORY_URL ?? "http://localhost:8002/mcp",
  enabled: process.env.CONTEXT_ENGINE_DISABLED !== "true",
  oauth: false as const,
}

export const MCP_NAME_INDEXER = "context-engine-indexer"
export const MCP_NAME_MEMORY = "context-engine-memory"
