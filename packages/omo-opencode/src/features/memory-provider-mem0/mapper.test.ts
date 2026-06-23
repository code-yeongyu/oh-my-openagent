import { describe, expect, it } from "bun:test"
import type { CanonicalMemory } from "../memory-core/types"
import { buildMem0SearchRequest, canonicalToMem0AddRequest, mem0ToL2SearchResult } from "./mapper"
import type { Mem0Memory } from "./types"

function buildCanonical(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  return {
    memory_id: "mem_123",
    project_id: "proj_alpha",
    memory_type: "decision",
    title: "Use Postgres for L3",
    summary: "L3 memory lives in Postgres.",
    why_it_matters: "Strong consistency.",
    scope: "backend",
    evidence: ["ADR-001"],
    tags: ["persistence", "pg"],
    status: "active",
    confidence: 0.9,
    source_kind: "session",
    source_refs: { session_id: "sess_1" },
    created_by: "user_42",
    created_at: "2026-04-11T00:00:00Z",
    updated_at: "2026-04-11T00:00:00Z",
    promotion_origin: "L1",
    provider_name: "mem0",
    provider_external_id: "",
    ...overrides,
  }
}

describe("canonicalToMem0AddRequest", () => {
  it("#given canonical memory #when mapped #then always sets infer true", () => {
    const req = canonicalToMem0AddRequest(buildCanonical())
    expect(req.infer).toBe(true)
  })

  it("#given canonical memory #when mapped #then builds user_id as project:createdBy", () => {
    const req = canonicalToMem0AddRequest(buildCanonical())
    expect(req.user_id).toBe("proj_alpha:user_42")
  })

  it("#given canonical memory #when mapped #then includes title in message content", () => {
    const req = canonicalToMem0AddRequest(buildCanonical())
    expect(req.messages).toHaveLength(1)
    expect(req.messages[0]?.content).toContain("Use Postgres for L3")
    expect(req.messages[0]?.content).toContain("[DECISION]")
    expect(req.messages[0]?.role).toBe("user")
  })

  it("#given memory with session_id #when mapped #then forwards run_id", () => {
    const req = canonicalToMem0AddRequest(buildCanonical({ source_refs: { session_id: "sess_xyz" } }))
    expect(req.run_id).toBe("sess_xyz")
  })

  it("#given canonical memory #when mapped #then stores only neutral metadata fields", () => {
    const req = canonicalToMem0AddRequest(buildCanonical())
    expect(req.metadata).toEqual({
      memory_id: "mem_123",
      project_id: "proj_alpha",
      memory_type: "decision",
      promotion_origin: "L1",
      source_kind: "session",
    })
  })
})

describe("mem0ToL2SearchResult", () => {
  it("#given mem0 result with forbidden fields #when mapped #then strips graph categories and rerank_score", () => {
    const mem: Mem0Memory & { graph?: unknown; rerank_score?: number } = {
      id: "m0_1",
      memory: "content",
      score: 0.8,
      categories: ["personal", "work"],
      graph: { entities: [{ type: "person", name: "Alice" }] },
      rerank_score: 0.99,
      metadata: { memory_id: "mem_999" },
    }
    const result = mem0ToL2SearchResult(mem)
    expect(result.metadata).not.toHaveProperty("categories")
    expect(result.metadata).not.toHaveProperty("graph")
    expect(result.metadata).not.toHaveProperty("rerank_score")
  })

  it("#given mem0 result #when mapped #then maps id to provider_external_id", () => {
    const result = mem0ToL2SearchResult({ id: "m0_xyz", memory: "content" })
    expect(result.provider_external_id).toBe("m0_xyz")
    expect(result.content).toBe("content")
    expect(result.score).toBe(0)
  })

  it("#given mem0 result with memory_id metadata #when mapped #then surfaces memory_id", () => {
    const result = mem0ToL2SearchResult({ id: "m0_1", memory: "x", metadata: { memory_id: "mem_ref" } })
    expect(result.memory_id).toBe("mem_ref")
  })
})

describe("buildMem0SearchRequest", () => {
  it("#given no user context #when building search #then always sets user_id (v2 gotcha)", () => {
    const req = buildMem0SearchRequest("foo", "proj_alpha")
    expect(req.user_id).toBe("proj_alpha:system")
  })

  it("#given default user id #when building search #then uses the default", () => {
    const req = buildMem0SearchRequest("foo", "proj_alpha", "user_42")
    expect(req.user_id).toBe("user_42")
  })

  it("#given options override user id #when building search #then options win", () => {
    const req = buildMem0SearchRequest("foo", "proj_alpha", "user_42", { user_id: "override" })
    expect(req.user_id).toBe("override")
  })

  it("#given options with limit #when building search #then maps to top_k", () => {
    const req = buildMem0SearchRequest("foo", "proj_alpha", undefined, { limit: 25 })
    expect(req.top_k).toBe(25)
  })

  it("#given no options #when building search #then top_k defaults to 10", () => {
    const req = buildMem0SearchRequest("foo", "proj_alpha")
    expect(req.top_k).toBe(10)
  })
})
