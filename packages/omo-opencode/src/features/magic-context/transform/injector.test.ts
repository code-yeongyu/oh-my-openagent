import { describe, it, expect, beforeAll, afterAll } from "bun:test"

import { createDb, closeQuietly, runMigrations } from "../db"
import { memories } from "../db"
import type { Database } from "../db/sqlite"
import type { Embedder } from "../embedding/provider"
import { createMagicContextInjector } from "./injector"
import { magicContextSchema } from "../../../config/schema/magic-context"

class FixedVectorEmbedder implements Embedder {
  getDimensions(): number {
    return 384
  }
  async embedText(_text: string): Promise<Float32Array> {
    const vec = new Float32Array(384)
    vec[0] = 1
    return vec
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const vec = new Float32Array(384)
      vec[0] = 1
      return vec
    })
  }
}

function seedMemory(
  db: Database,
  overrides: { projectPath: string; category: string; content: string; sessionId: string },
): void {
  const mem = memories.insertMemory(db, {
    projectPath: overrides.projectPath,
    category: overrides.category as memories.MemoryCategory,
    content: overrides.content,
    sourceType: "user",
    sourceSessionId: overrides.sessionId,
  })
  const vec = new Float32Array(384)
  vec[0] = 1
  memories.saveMemoryEmbedding(db, mem.id, vec, "test-model")
}

describe("createMagicContextInjector", () => {
  let db: Database
  let embedder: Embedder
  let config: ReturnType<typeof magicContextSchema.parse>

  beforeAll(() => {
    db = createDb(":memory:")
    runMigrations(db)
    embedder = new FixedVectorEmbedder()
    config = magicContextSchema.parse({
      enabled: true,
      memory: {
        enabled: true,
        auto_search: { enabled: true, score_threshold: 0, min_prompt_chars: 1 },
      },
    })
  })

  afterAll(() => {
    closeQuietly(db)
  })

  it("returns matching memory content when query matches seeded memory", async () => {
    const PROJECT = "/test/project"
    const SESSION = "ses_test_injector"

    seedMemory(db, {
      projectPath: PROJECT,
      category: "ARCHITECTURE",
      content: "The Magic Context system uses semantic search over stored memories to inject relevant knowledge into conversations.",
      sessionId: SESSION,
    })

    const injector = createMagicContextInjector(config, db, embedder)

    const result = await injector.injectContext({
      messages: [{ role: "user", content: "How does Magic Context find relevant memories?" }],
      sessionId: SESSION,
      projectPath: PROJECT,
    })

    expect(result.length).toBeGreaterThan(0)
    const joined = result.join(" ")
    expect(joined).toContain("Magic Context")
    expect(joined).toContain("semantic search")
    expect(joined).toContain("relevant knowledge")
  })

  it("returns empty array when magic context is disabled", async () => {
    const disabledConfig = magicContextSchema.parse({
      enabled: false,
    })

    const injector = createMagicContextInjector(disabledConfig, db, embedder)

    const result = await injector.injectContext({
      messages: [{ role: "user", content: "test query" }],
      sessionId: "ses_disabled",
      projectPath: "/test",
    })

    expect(result).toEqual([])
  })

  it("returns empty array when there are no user messages", async () => {
    const injector = createMagicContextInjector(config, db, embedder)

    const result = await injector.injectContext({
      messages: [],
      sessionId: "ses_no_user",
      projectPath: "/test",
    })

    expect(result).toEqual([])
  })

  it("returns empty array when last message is not a user message", async () => {
    const injector = createMagicContextInjector(config, db, embedder)

    const result = await injector.injectContext({
      messages: [{ role: "assistant", content: "I am the assistant" }],
      sessionId: "ses_assistant_only",
      projectPath: "/test",
    })

    expect(result).toEqual([])
  })
})
