import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

import type { MagicContextConfig } from "../../config/schema/magic-context"
import type { MagicContextToolsDeps } from "./tools"
import { createDb, runMigrations } from "./db"
import { createEmbedder } from "./embedding/embedder"
import { createSearchEngine } from "./search"

/**
 * Resolve the SQLite database path for Magic Context storage.
 *
 * - Absolute `config.sqlite.path` is used as-is.
 * - Relative `config.sqlite.path` is resolved against the project `directory`.
 * - `null`/empty falls back to `~/.omo/magic-context.db`.
 */
export function resolveMagicContextDbPath(config: MagicContextConfig, directory: string): string {
  const raw = config.sqlite.path
  if (raw && raw.length > 0) {
    return isAbsolute(raw) ? raw : join(directory, raw)
  }
  return join(homedir(), ".omo", "magic-context.db")
}

/**
 * Build the runtime dependencies for Magic Context tools + transform hook.
 *
 * Returns `null` when Magic Context is disabled, so callers can skip wiring.
 * The embedder + search engine are constructed from the resolved config.
 */
export function createMagicContextDeps(
  config: MagicContextConfig | undefined,
  directory: string,
): MagicContextToolsDeps | null {
  if (!config?.enabled) return null

  const dbPath = resolveMagicContextDbPath(config, directory)
  const db = createDb(dbPath)
  runMigrations(db)

  // "off" is a config-only sentinel (no real embeddings); fall back to the
  // default OpenAI-compatible embedder so search still has a vector source.
  const provider =
    config.embedding.provider === "off" ? "openai-compatible" : config.embedding.provider

  const embedder = createEmbedder({
    provider,
    model: config.embedding.model,
    endpoint: config.embedding.endpoint,
    apiKey: config.embedding.api_key,
  })

  // Stable id for embedding storage/lookup. Search does not filter by it, but
  // loadMemoryEmbeddings does, so store + load must agree.
  const modelId = `${provider}:${config.embedding.model || "default"}`

  const searchEngine = createSearchEngine(db, embedder)

  return {
    db,
    embedder,
    modelId,
    searchEngine,
    resolveProjectPath: (d: string) => d,
  }
}
