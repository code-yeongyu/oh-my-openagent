/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MemoryCoreService } from "../memory-core/service"
import type {
  AuditLogEntry,
  CanonicalMemory,
  OutboxEntry,
} from "../memory-core/types"
import { applyCuratorDecisions } from "./decision-applicator"
import type { CuratorDecision } from "./types"

interface ServiceStubState {
  memories: Map<string, CanonicalMemory>
  updates: Array<{ memory_id: string; patch: Partial<CanonicalMemory> }>
  archived: string[]
  outbox: Omit<OutboxEntry, "created_at" | "retry_count">[]
  audit: Array<Omit<AuditLogEntry, "created_at">>
}

function buildMemory(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  const now = "2026-04-19T00:00:00.000Z"
  return {
    memory_id: "m_base",
    project_id: "super-agent",
    memory_type: "discovery",
    title: "Base memory",
    summary: "Base summary",
    why_it_matters: "Because reasons",
    scope: "ses_x",
    evidence: [],
    tags: ["base"],
    status: "pending_review",
    confidence: 0.5,
    source_kind: "session",
    source_refs: { work_item_id: "w1" },
    created_by: "hook",
    created_at: now,
    updated_at: now,
    promotion_origin: "L1",
    provider_name: "canonical",
    provider_external_id: "m_base",
    ...overrides,
  }
}

function buildServiceStub(memories: CanonicalMemory[] = []): {
  service: MemoryCoreService
  state: ServiceStubState
} {
  const state: ServiceStubState = {
    memories: new Map(memories.map((m) => [m.memory_id, { ...m }])),
    updates: [],
    archived: [],
    outbox: [],
    audit: [],
  }

  const stub = {
    async get(memoryId: string) {
      return state.memories.get(memoryId)
    },
    async update(memoryId: string, patch: Partial<CanonicalMemory>) {
      state.updates.push({ memory_id: memoryId, patch })
      const current = state.memories.get(memoryId)
      if (current) {
        const merged = { ...current, ...patch }
        state.memories.set(memoryId, merged)
        return merged
      }
      throw new Error(`Memory ${memoryId} not found`)
    },
    async archive(memoryId: string) {
      state.archived.push(memoryId)
      const current = state.memories.get(memoryId)
      if (current) state.memories.set(memoryId, { ...current, status: "archived" })
    },
    async enqueueOutbox(entry: Omit<OutboxEntry, "created_at" | "retry_count">) {
      state.outbox.push(entry)
    },
    async appendAuditLog(entry: Omit<AuditLogEntry, "created_at">) {
      state.audit.push(entry)
    },
  } as unknown as MemoryCoreService

  return { service: stub, state }
}

describe("applyCuratorDecisions", () => {
  describe("#given a PROMOTE decision", () => {
    test("#when applied #then memory becomes active and outbox entry is enqueued", async () => {
      const { service, state } = buildServiceStub([buildMemory({ memory_id: "m_1" })])
      const decisions: CuratorDecision[] = [
        {
          action: "PROMOTE",
          memory_id: "m_1",
          target_tier: "L2",
          reason: "cross-session decision",
        },
      ]

      const result = await applyCuratorDecisions({ service }, decisions)

      expect(result.applied).toHaveLength(1)
      expect(state.memories.get("m_1")?.status).toBe("active")
      expect(state.outbox.map((e) => e.provider_name)).toContain("mem0")
      expect(state.audit.some((a) => a.action === "promoted")).toBe(true)
    })

    test("#when target_tier is L3 #then corpus-ingestor outbox is enqueued", async () => {
      const { service, state } = buildServiceStub([buildMemory({ memory_id: "m_l3" })])
      const decisions: CuratorDecision[] = [
        {
          action: "PROMOTE",
          memory_id: "m_l3",
          target_tier: "L3",
          reason: "large document",
        },
      ]

      await applyCuratorDecisions({ service }, decisions)

      expect(state.outbox.map((e) => e.provider_name)).toContain("corpus-ingestor")
    })

    test("#when memory does not exist #then skipped with reason", async () => {
      const { service } = buildServiceStub()
      const result = await applyCuratorDecisions({ service }, [
        { action: "PROMOTE", memory_id: "missing", target_tier: "L2", reason: "x" },
      ])
      expect(result.applied).toHaveLength(0)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]?.reason).toBe("memory-not-found")
    })
  })

  describe("#given a MERGE decision", () => {
    test("#when applied #then merge targets are archived and keep summary is updated", async () => {
      const { service, state } = buildServiceStub([
        buildMemory({ memory_id: "m_keep", summary: "original" }),
        buildMemory({ memory_id: "m_dup1" }),
        buildMemory({ memory_id: "m_dup2" }),
      ])
      const decisions: CuratorDecision[] = [
        {
          action: "MERGE",
          keep_memory_id: "m_keep",
          merge_memory_ids: ["m_dup1", "m_dup2"],
          reason: "same topic",
          canonical_summary: "unified summary",
        },
      ]

      await applyCuratorDecisions({ service }, decisions)

      expect(state.memories.get("m_keep")?.summary).toBe("unified summary")
      expect(state.archived.sort()).toEqual(["m_dup1", "m_dup2"])
    })
  })

  describe("#given a SUPERSEDE decision", () => {
    test("#when applied #then old is archived and new has supersedes ref", async () => {
      const { service, state } = buildServiceStub([
        buildMemory({ memory_id: "m_new" }),
        buildMemory({ memory_id: "m_old" }),
      ])
      const decisions: CuratorDecision[] = [
        {
          action: "SUPERSEDE",
          new_memory_id: "m_new",
          old_memory_id: "m_old",
          reason: "newer decision",
        },
      ]

      await applyCuratorDecisions({ service }, decisions)

      expect(state.archived).toContain("m_old")
      const newMemory = state.memories.get("m_new")
      expect(newMemory?.source_refs.supersedes).toBe("m_old")
    })
  })

  describe("#given a TAG decision", () => {
    test("#when applied #then patch fields are updated", async () => {
      const { service, state } = buildServiceStub([
        buildMemory({ memory_id: "m_tag", tags: ["a"], confidence: 0.5 }),
      ])
      const decisions: CuratorDecision[] = [
        {
          action: "TAG",
          memory_id: "m_tag",
          patch: { tags: ["a", "b", "c"], confidence: 0.9 },
          reason: "richer metadata",
        },
      ]

      await applyCuratorDecisions({ service }, decisions)

      const memory = state.memories.get("m_tag")
      expect(memory?.tags).toEqual(["a", "b", "c"])
      expect(memory?.confidence).toBe(0.9)
    })
  })

  describe("#given a NOOP decision", () => {
    test("#when applied #then it is recorded as skipped (not applied, not failed)", async () => {
      const { service, state } = buildServiceStub([buildMemory({ memory_id: "m_noop" })])
      const result = await applyCuratorDecisions({ service }, [
        { action: "NOOP", memory_id: "m_noop", reason: "canonical" },
      ])

      expect(result.applied).toHaveLength(0)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]?.reason).toBe("noop")
      expect(state.archived).toHaveLength(0)
      expect(state.outbox).toHaveLength(0)
    })
  })

  describe("#given mixed decisions with one that throws", () => {
    test("#when applied #then other decisions still succeed", async () => {
      const memories = [buildMemory({ memory_id: "m_ok" })]
      const { service, state } = buildServiceStub(memories)
      const decisions: CuratorDecision[] = [
        { action: "PROMOTE", memory_id: "m_ok", target_tier: "L2", reason: "ok" },
        { action: "TAG", memory_id: "m_missing", patch: { tags: ["x"] }, reason: "missing" },
      ]

      const result = await applyCuratorDecisions({ service }, decisions)

      expect(result.applied).toHaveLength(1)
      expect(result.skipped).toHaveLength(1)
      expect(state.updates.some((u) => u.memory_id === "m_ok")).toBe(true)
    })
  })
})
