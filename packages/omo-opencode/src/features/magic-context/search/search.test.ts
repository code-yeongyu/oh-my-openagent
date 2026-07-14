import { describe, it, expect, afterEach } from "bun:test"
import { createDb, closeQuietly } from "../db/sqlite"
import type { Database } from "../db/sqlite"
import { runMigrations } from "../db/migrate"
import { insertMemory, saveMemoryEmbedding } from "../db/queries/memories"
import { upsertCommit } from "../db/queries/commits"
import { createSearchEngine } from "./engine"
import type { Embedder } from "../embedding/provider"

function createMockEmbedder(dims = 4): Embedder {
  const vec = new Float32Array(dims)
  vec[0] = 1
  return {
    embedText: async () => new Float32Array(vec),
    embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(vec)),
    getDimensions: () => dims,
  }
}

describe("createSearchEngine", () => {
  let db: Database

  afterEach(() => {
    closeQuietly(db)
  })

  it("returns ranked memory results for a semantic query", async () => {
    db = createDb(":memory:")
    runMigrations(db)

    const memory = insertMemory(db, {
      projectPath: "/test/project",
      category: "ARCHITECTURE",
      content: "The system uses a modular plugin architecture with event-driven hooks.",
    })
    saveMemoryEmbedding(db, memory.id, new Float32Array([1, 0, 0, 0]), "test-model")

    const engine = createSearchEngine(db, createMockEmbedder())
    const results = await engine.search({
      text: "plugin architecture",
      sessionId: "test-session",
      projectPath: "/test/project",
      sources: ["memory"],
      limit: 10,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].source).toBe("memory")
    expect(results[0].content).toContain("plugin architecture")
    expect(results[0].score).toBeGreaterThan(0)
  })

  it("returns empty results when no sources match", async () => {
    db = createDb(":memory:")
    runMigrations(db)

    const engine = createSearchEngine(db, createMockEmbedder())
    const results = await engine.search({
      text: "nothing matches",
      sessionId: "test-session",
      projectPath: "/test/project",
      limit: 10,
    })

    expect(results).toEqual([])
  })

  it("searches commits with FTS", async () => {
    db = createDb(":memory:")
    runMigrations(db)

    upsertCommit(db, "/test/project", {
      sha: "abc123def456",
      shortSha: "abc123d",
      message: "Add event-driven hook system for modular plugins",
      author: "dev",
      committedAtMs: Date.now(),
    })

    const engine = createSearchEngine(db, createMockEmbedder())
    const results = await engine.search({
      text: "modular plugins",
      sessionId: "test-session",
      projectPath: "/test/project",
      sources: ["commit"],
      limit: 10,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].source).toBe("commit")
    expect(results[0].content).toContain("modular plugins")
  })

  it("returns commit semantic hits when embeddings exist", async () => {
    db = createDb(":memory:")
    runMigrations(db)

    upsertCommit(db, "/test/project", {
      sha: "def789abc012",
      shortSha: "def789a",
      message: "Refactor the event dispatcher to support backpressure",
      author: "eng",
      committedAtMs: Date.now(),
    })
    const emb = new Float32Array([1, 0, 0, 0])
    const blob = new Uint8Array(emb.buffer, emb.byteOffset, emb.byteLength)
    db.prepare(
      "INSERT INTO git_commit_embeddings (sha, embedding, model_id, created_at) VALUES (?, ?, ?, ?)",
    ).run("def789abc012", blob, "test-model", Date.now())

    const engine = createSearchEngine(db, createMockEmbedder())
    const results = await engine.search({
      text: "dispatcher backpressure",
      sessionId: "test-session",
      projectPath: "/test/project",
      sources: ["commit"],
      limit: 10,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].source).toBe("commit")
  })

  it("returns empty for blank query", async () => {
    db = createDb(":memory:")
    runMigrations(db)

    const engine = createSearchEngine(db, createMockEmbedder())
    const results = await engine.search({
      text: "   ",
      sessionId: "test-session",
      projectPath: "/test/project",
    })

    expect(results).toEqual([])
  })
})
