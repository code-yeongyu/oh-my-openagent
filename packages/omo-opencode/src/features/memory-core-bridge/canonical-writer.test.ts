/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import type { MemoryCoreService } from "../memory-core/service"
import type {
  AuditLogEntry,
  CanonicalMemory,
  OutboxEntry,
} from "../memory-core/types"
import { writeCanonicalWithOutbox } from "./canonical-writer"

interface RecordingServiceState {
  createCalls: Array<Parameters<MemoryCoreService["create"]>[0]>
  outboxCalls: Array<Parameters<MemoryCoreService["enqueueOutbox"]>[0]>
  auditCalls: Array<Parameters<MemoryCoreService["appendAuditLog"]>[0]>
}

function buildRecordingService(): {
  service: MemoryCoreService
  state: RecordingServiceState
} {
  const state: RecordingServiceState = {
    createCalls: [],
    outboxCalls: [],
    auditCalls: [],
  }

  const stub = {
    async create(draft: Omit<CanonicalMemory, "created_at" | "updated_at">) {
      state.createCalls.push(draft)
      const now = "2026-04-19T00:00:00.000Z"
      return { ...draft, created_at: now, updated_at: now }
    },
    async enqueueOutbox(entry: Omit<OutboxEntry, "created_at" | "retry_count">) {
      state.outboxCalls.push(entry)
    },
    async appendAuditLog(entry: Omit<AuditLogEntry, "created_at">) {
      state.auditCalls.push(entry)
    },
  } as unknown as MemoryCoreService

  return { service: stub, state }
}

function buildWorkItem(overrides: Partial<MemoryWorkItem> = {}): MemoryWorkItem {
  return {
    id: "work_001",
    type: "tool_observation",
    source: "hook:PostToolUse",
    project: "super-agent",
    contentSessionId: "ses_abc",
    candidateTargets: ["l1", "l2"],
    contentKind: "observation",
    importance: 0.5,
    dedupeKey: "tool_observation:hook:PostToolUse:ses_abc",
    payload: { title: "test memory" },
    ...overrides,
  }
}

describe("writeCanonicalWithOutbox", () => {
  describe("#given a fresh work item with two targets", () => {
    test("#when writing #then service.create is called once with canonical draft", async () => {
      const { service, state } = buildRecordingService()

      await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_001",
          obsidianEnabled: false,
        },
        { workItem: buildWorkItem(), targets: ["l1", "l2"] },
      )

      expect(state.createCalls).toHaveLength(1)
      expect(state.createCalls[0]?.memory_id).toBe("m_001")
      expect(state.createCalls[0]?.title).toBe("test memory")
    })

    test("#when writing #then two outbox entries are enqueued", async () => {
      const { service, state } = buildRecordingService()

      await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_002",
          obsidianEnabled: false,
        },
        { workItem: buildWorkItem(), targets: ["l1", "l2"] },
      )

      expect(state.outboxCalls).toHaveLength(2)
      expect(state.outboxCalls.map((c) => c.provider_name).sort()).toEqual([
        "claude-mem",
        "mem0",
      ])
    })

    test("#when writing #then audit log receives a created action", async () => {
      const { service, state } = buildRecordingService()

      await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_003",
          obsidianEnabled: false,
        },
        { workItem: buildWorkItem(), targets: ["l1"] },
      )

      expect(state.auditCalls).toHaveLength(1)
      expect(state.auditCalls[0]?.action).toBe("created")
      expect(state.auditCalls[0]?.memory_id).toBe("m_003")
    })

    test("#when writing #then returned result contains memory and outbox ids", async () => {
      const { service } = buildRecordingService()

      const result = await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_004",
          obsidianEnabled: false,
        },
        { workItem: buildWorkItem(), targets: ["l1", "l2"] },
      )

      expect(result.memory.memory_id).toBe("m_004")
      expect(result.outboxIds.sort()).toEqual(["m_004:l1", "m_004:l2"])
    })
  })

  describe("#given obsidian enabled", () => {
    test("#when writing #then outbox includes an obsidian entry", async () => {
      const { service, state } = buildRecordingService()

      await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_005",
          obsidianEnabled: true,
        },
        { workItem: buildWorkItem(), targets: ["l1"] },
      )

      expect(state.outboxCalls.map((c) => c.provider_name).sort()).toEqual([
        "claude-mem",
        "obsidian",
      ])
    })
  })

  describe("#given outbox enqueue fails on one target", () => {
    test("#when one entry rejects #then other entries are still enqueued", async () => {
      const attempts: string[] = []
      const service = {
        async create(draft: Omit<CanonicalMemory, "created_at" | "updated_at">) {
          const now = "2026-04-19T00:00:00.000Z"
          return { ...draft, created_at: now, updated_at: now }
        },
        async enqueueOutbox(entry: Omit<OutboxEntry, "created_at" | "retry_count">) {
          attempts.push(entry.provider_name)
          if (entry.provider_name === "mem0") {
            throw new Error("connection reset")
          }
        },
        async appendAuditLog() {},
      } as unknown as MemoryCoreService

      const result = await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_006",
          obsidianEnabled: true,
        },
        { workItem: buildWorkItem(), targets: ["l1", "l2"] },
      )

      expect(attempts.sort()).toEqual(["claude-mem", "mem0", "obsidian"])
      expect(result.outboxIds.sort()).toEqual(["m_006:l1", "m_006:obsidian"])
    })
  })

  describe("#given activeProviders filter", () => {
    test("#when a target maps to an inactive provider #then its outbox entry is skipped", async () => {
      const { service, state } = buildRecordingService()

      await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_filter_001",
          obsidianEnabled: true,
          activeProviders: new Set(["obsidian"]),
        },
        { workItem: buildWorkItem(), targets: ["l1", "l2"] },
      )

      expect(state.outboxCalls.map((c) => c.provider_name).sort()).toEqual(["obsidian"])
    })

    test("#when all targets map to inactive providers #then no outbox entries are enqueued", async () => {
      const { service, state } = buildRecordingService()

      await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_filter_002",
          obsidianEnabled: false,
          activeProviders: new Set<string>(),
        },
        { workItem: buildWorkItem(), targets: ["l1", "l2", "l3"] },
      )

      expect(state.outboxCalls).toHaveLength(0)
    })

    test("#when activeProviders is undefined #then no filtering is applied", async () => {
      const { service, state } = buildRecordingService()

      await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_filter_003",
          obsidianEnabled: false,
        },
        { workItem: buildWorkItem(), targets: ["l1", "l2"] },
      )

      expect(state.outboxCalls.map((c) => c.provider_name).sort()).toEqual([
        "claude-mem",
        "mem0",
      ])
    })
  })

  describe("#given audit log append throws", () => {
    test("#when audit fails #then write still returns normally", async () => {
      const service = {
        async create(draft: Omit<CanonicalMemory, "created_at" | "updated_at">) {
          const now = "2026-04-19T00:00:00.000Z"
          return { ...draft, created_at: now, updated_at: now }
        },
        async enqueueOutbox() {},
        async appendAuditLog() {
          throw new Error("audit append failed")
        },
      } as unknown as MemoryCoreService

      const result = await writeCanonicalWithOutbox(
        {
          service,
          actor: "memory-dispatcher",
          generateMemoryId: () => "m_007",
          obsidianEnabled: false,
        },
        { workItem: buildWorkItem(), targets: ["l1"] },
      )

      expect(result.memory.memory_id).toBe("m_007")
    })
  })
})
