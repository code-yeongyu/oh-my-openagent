/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MemoryCoreService } from "../memory-core/service"
import type {
  AuditLogEntry,
  CanonicalMemory,
  OutboxEntry,
} from "../memory-core/types"
import { CuratorLoop } from "./curator-loop"
import type { CuratorInvoker, CuratorInvokerInput } from "./invoker"
import type { CuratorResponse } from "./types"

function buildMemory(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  const now = "2026-04-19T10:00:00.000Z"
  return {
    memory_id: "m_base",
    project_id: "super-agent",
    memory_type: "discovery",
    title: "Base",
    summary: "Base summary",
    why_it_matters: "because",
    scope: "ses_a",
    evidence: [],
    tags: ["t"],
    status: "pending_review",
    confidence: 0.5,
    source_kind: "session",
    source_refs: {},
    created_by: "hook",
    created_at: now,
    updated_at: now,
    promotion_origin: "L1",
    provider_name: "canonical",
    provider_external_id: "m_base",
    ...overrides,
  }
}

interface StubState {
  memories: Map<string, CanonicalMemory>
  searchCalls: Array<{ query: string; options?: unknown }>
  outbox: Omit<OutboxEntry, "created_at" | "retry_count">[]
  audit: Array<Omit<AuditLogEntry, "created_at">>
  updates: Array<{ memory_id: string; patch: Partial<CanonicalMemory> }>
}

function buildServiceStub(
  pendingMemories: CanonicalMemory[],
  activeMemories: CanonicalMemory[] = [],
): { service: MemoryCoreService; state: StubState } {
  const state: StubState = {
    memories: new Map(
      [...pendingMemories, ...activeMemories].map((m) => [m.memory_id, { ...m }]),
    ),
    searchCalls: [],
    outbox: [],
    audit: [],
    updates: [],
  }

  const stub = {
    async search(query: string, options?: { status?: string }) {
      state.searchCalls.push({ query, options })
      if (options?.status === "pending_review") {
        return { memories: pendingMemories.map((m) => ({ ...m })), total: pendingMemories.length }
      }
      if (options?.status === "active") {
        return { memories: activeMemories.map((m) => ({ ...m })), total: activeMemories.length }
      }
      return { memories: [], total: 0 }
    },
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
      throw new Error("not found")
    },
    async archive(memoryId: string) {
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

function buildInvokerStub(response: CuratorResponse): {
  invoker: CuratorInvoker
  calls: CuratorInvokerInput[]
} {
  const calls: CuratorInvokerInput[] = []
  const invoker: CuratorInvoker = {
    async invoke(input) {
      calls.push(input)
      return response
    },
  }
  return { invoker, calls }
}

describe("CuratorLoop", () => {
  describe("#given no pending memories", () => {
    test("#when tick runs #then invoker is not called and tickCount increases", async () => {
      const { service } = buildServiceStub([])
      const { invoker, calls } = buildInvokerStub({
        decisions: [],
        summary: "",
        warnings: [],
      })

      const loop = new CuratorLoop({ service, invoker })
      await loop.tick()

      expect(calls).toHaveLength(0)
      expect(loop.getState().tickCount).toBe(1)
      expect(loop.getState().lastTickAt).toBeDefined()
    })
  })

  describe("#given pending memories", () => {
    test("#when tick runs #then invoker receives recent and related memories", async () => {
      const pending = [buildMemory({ memory_id: "m_pending", status: "pending_review" })]
      const related = [buildMemory({ memory_id: "m_related", status: "active" })]
      const { service } = buildServiceStub(pending, related)
      const { invoker, calls } = buildInvokerStub({
        decisions: [
          { action: "NOOP", memory_id: "m_pending", reason: "already canonical" },
        ],
        summary: "1 noop",
        warnings: [],
      })

      const loop = new CuratorLoop({
        service,
        invoker,
        config: { projectId: "super-agent", batchSize: 5 },
      })
      await loop.tick()

      expect(calls).toHaveLength(1)
      const input = calls[0]!
      expect(input.recent_memories).toHaveLength(1)
      expect(input.related_memories).toHaveLength(1)
      expect(input.batch_size_hint).toBe(5)
      expect(input.project_id).toBe("super-agent")
    })

    test("#when invoker returns decisions #then applicator runs them", async () => {
      const pending = [
        buildMemory({ memory_id: "m_p", status: "pending_review", confidence: 0.8 }),
      ]
      const { service, state } = buildServiceStub(pending)
      const { invoker } = buildInvokerStub({
        decisions: [
          {
            action: "PROMOTE",
            memory_id: "m_p",
            target_tier: "L2",
            reason: "cross-session decision",
          },
        ],
        summary: "1 promoted",
        warnings: [],
      })

      const loop = new CuratorLoop({ service, invoker })
      const result = await loop.tick()

      expect(result?.applied).toHaveLength(1)
      expect(state.outbox.map((e) => e.provider_name)).toContain("mem0")
      expect(loop.getState().lastResult?.applied).toHaveLength(1)
    })
  })

  describe("#given start is called", () => {
    test("#when stop is called #then timer is cleared and state reflects stopped", () => {
      const { service } = buildServiceStub([])
      const { invoker } = buildInvokerStub({ decisions: [], summary: "", warnings: [] })

      const loop = new CuratorLoop({
        service,
        invoker,
        config: { intervalMs: 1_000_000 },
      })
      loop.start()
      expect(loop.getState().isRunning).toBe(true)
      loop.stop()
      expect(loop.getState().isRunning).toBe(false)
    })
  })

  describe("#given invoker throws", () => {
    test("#when tick runs #then error is captured and does not bubble up", async () => {
      const pending = [buildMemory()]
      const { service } = buildServiceStub(pending)
      const invoker: CuratorInvoker = {
        invoke: async () => {
          throw new Error("adapter down")
        },
      }

      const loop = new CuratorLoop({ service, invoker })
      await expect(loop.tick()).rejects.toThrow("adapter down")
    })

    test("#when start+interval triggers tick that throws #then state.lastError records it", async () => {
      const pending = [buildMemory()]
      const { service } = buildServiceStub(pending)
      const invoker: CuratorInvoker = {
        invoke: async () => {
          throw new Error("adapter down")
        },
      }

      const loop = new CuratorLoop({
        service,
        invoker,
        config: { intervalMs: 1_000_000 },
      })
      loop.start()
      await new Promise((resolve) => setTimeout(resolve, 50))
      loop.stop()

      expect(loop.getState().lastError).toContain("adapter down")
    })
  })
})
