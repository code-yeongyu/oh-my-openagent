import { describe, expect, it } from "bun:test"
import { createDb, runMigrations, memories } from "../db"
import { createSearchEngine } from "../search"
import type { Embedder } from "../embedding/provider"
import type { MagicContextConfig } from "../../../config/schema/magic-context"
import { createCtxRememberTool } from "./ctx-remember"
import { createCtxListTool } from "./ctx-list"
import { createCtxSearchTool } from "./ctx-search"

const TEST_PROJECT_PATH = "/test/project"

const mockConfig: MagicContextConfig = {
  enabled: true,
  sqlite: { path: null },
  historian: {
    model: "",
    fallback_models: [],
    two_pass: false,
    disallowed_tools: [],
    execute_threshold: 65,
    timeout_ms: 300000,
  },
  dreamer: { enabled: true },
  sidekick: { enabled: true },
  embedding: {
    provider: "openai-compatible",
    model: "test",
    endpoint: "",
    api_key: "",
    max_input_tokens: 8192,
  },
  memory: {
    enabled: true,
    auto_search: { enabled: true, score_threshold: 0.6, min_prompt_chars: 40 },
    git_commit_indexing: { enabled: false, since_days: 90, max_commits: 200 },
  },
  ctx_reduce_enabled: true,
  keep_subagents: false,
}

function makeEmbedder(): Embedder {
  const dims = 8
  const mockVector = new Float32Array(dims).fill(1)
  return {
    embedText: async (_text: string) => mockVector,
    embedBatch: async (_texts: string[]) => [mockVector],
    getDimensions: () => dims,
  }
}

describe("magic-context tools", () => {
  it("ctx_remember -> ctx_list -> ctx_search", async () => {
    const db = createDb(":memory:")
    runMigrations(db)

    const embedder = makeEmbedder()
    const searchEngine = createSearchEngine(db, embedder)
    const sessionId = crypto.randomUUID()
    const resolveProjectPath = (d: string) => d

    // ── ctx_remember ──────────────────────────────────────────
    const rememberTool = createCtxRememberTool(mockConfig, {
      db,
      embedder,
      modelId: "test-model",
      resolveProjectPath,
    })
    const rememberResult = await rememberTool.execute(
      { content: "KLC uses Docker Compose v1.29.2" },
      // biome-ignore lint/suspicious/noExplicitAny: toolContext shape from plugin SDK
      { sessionID: sessionId, directory: TEST_PROJECT_PATH } as any,
    )
    expect(rememberResult).toMatch(/Saved memory \[ID: \d+\]/)

    // ── ctx_list ──────────────────────────────────────────────
    const listTool = createCtxListTool(mockConfig, { db, resolveProjectPath })
    const listResult = await listTool.execute(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: toolContext shape
      { sessionID: sessionId, directory: TEST_PROJECT_PATH } as any,
    )
    expect(listResult).toContain("KLC uses Docker Compose")

    // ── ctx_search ────────────────────────────────────────────
    const searchTool = createCtxSearchTool(mockConfig, { searchEngine })
    const searchResult = await searchTool.execute(
      { query: "Docker Compose" },
      // biome-ignore lint/suspicious/noExplicitAny: toolContext shape
      { sessionID: sessionId, directory: TEST_PROJECT_PATH } as any,
    )
    expect(searchResult).toContain("KLC uses Docker Compose")

    db.close()
  })
})
