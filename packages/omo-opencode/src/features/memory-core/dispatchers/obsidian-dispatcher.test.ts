/// <reference types="bun-types" />

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { MemoryCoreService } from "../service"
import type {
  AuditLogEntry,
  CanonicalMemory,
  OutboxEntry,
  SyncState,
} from "../types"
import { createObsidianDispatcher } from "./obsidian-dispatcher"

function buildMemory(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  const now = "2026-04-19T00:00:00.000Z"
  return {
    memory_id: "m_disp_01",
    project_id: "super-agent",
    memory_type: "discovery",
    title: "Dispatcher vault write",
    summary: "Outbox worker writes a note to the vault",
    why_it_matters: "End-to-end outbox dispatch works",
    scope: "ses_disp",
    evidence: [],
    tags: ["outbox"],
    status: "pending_review",
    confidence: 0.7,
    source_kind: "session",
    source_refs: { work_item_id: "work_disp_01" },
    created_by: "memory-dispatcher",
    created_at: now,
    updated_at: now,
    promotion_origin: "L1",
    provider_name: "canonical",
    provider_external_id: "m_disp_01",
    ...overrides,
  }
}

function buildOutboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    outbox_id: "m_disp_01:obsidian",
    memory_id: "m_disp_01",
    provider_name: "obsidian",
    operation: "create",
    idempotency_key: "dedupe:obsidian",
    status: "pending",
    created_at: "2026-04-19T00:00:00.000Z",
    retry_count: 0,
    ...overrides,
  }
}

interface ServiceStubState {
  memoryById: Map<string, CanonicalMemory>
  syncStateById: Map<string, SyncState>
  updatedSyncStates: SyncState[]
  auditCalls: Array<Omit<AuditLogEntry, "created_at">>
}

function buildServiceStub(initialMemory?: CanonicalMemory): {
  service: MemoryCoreService
  state: ServiceStubState
} {
  const state: ServiceStubState = {
    memoryById: new Map(),
    syncStateById: new Map(),
    updatedSyncStates: [],
    auditCalls: [],
  }
  if (initialMemory) state.memoryById.set(initialMemory.memory_id, initialMemory)

  const stub = {
    async get(memoryId: string) {
      return state.memoryById.get(memoryId)
    },
    async getSyncState(memoryId: string, providerName: string) {
      return state.syncStateById.get(`${memoryId}:${providerName}`)
    },
    async updateSyncState(newState: SyncState) {
      state.syncStateById.set(
        `${newState.memory_id}:${newState.provider_name}`,
        newState,
      )
      state.updatedSyncStates.push(newState)
    },
    async appendAuditLog(entry: Omit<AuditLogEntry, "created_at">) {
      state.auditCalls.push(entry)
    },
  } as unknown as MemoryCoreService

  return { service: stub, state }
}

describe("createObsidianDispatcher", () => {
  let vault: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "omo-dispatcher-vault-"))
  })

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true })
  })

  describe("#given a non-obsidian provider entry", () => {
    test("#when dispatched #then nothing happens", async () => {
      const { service } = buildServiceStub(buildMemory())
      const dispatcher = createObsidianDispatcher({ service, vaultPath: vault })

      await dispatcher.dispatch(buildOutboxEntry({ provider_name: "mem0" }))

      expect(existsSync(join(vault, "10_Zettels"))).toBe(false)
    })
  })

  describe("#given memory_id does not exist in service", () => {
    test("#when dispatched #then throws", async () => {
      const { service } = buildServiceStub()
      const dispatcher = createObsidianDispatcher({ service, vaultPath: vault })

      await expect(dispatcher.dispatch(buildOutboxEntry())).rejects.toThrow(
        "memory not found",
      )
    })
  })

  describe("#given a valid canonical memory", () => {
    test("#when dispatched #then a vault note is written", async () => {
      const { service } = buildServiceStub(buildMemory())
      const dispatcher = createObsidianDispatcher({ service, vaultPath: vault })

      await dispatcher.dispatch(buildOutboxEntry())

      const zettels = readdirSync(join(vault, "10_Zettels"))
      expect(zettels.some((name) => name.endsWith(".md"))).toBe(true)
    })

    test("#when dispatched #then sync state is recorded", async () => {
      const { service, state } = buildServiceStub(buildMemory())
      const dispatcher = createObsidianDispatcher({ service, vaultPath: vault })

      await dispatcher.dispatch(buildOutboxEntry())

      expect(state.updatedSyncStates).toHaveLength(1)
      expect(state.updatedSyncStates[0]?.provider_name).toBe("obsidian")
      expect(state.updatedSyncStates[0]?.sync_status).toBe("synced")
      expect(state.updatedSyncStates[0]?.last_projected_sha256).toBeDefined()
    })
  })

  describe("#given the same memory dispatched twice with recorded sync state", () => {
    test("#when second dispatch finds matching hash #then rewrite is idempotent", async () => {
      const { service } = buildServiceStub(buildMemory())
      const dispatcher = createObsidianDispatcher({ service, vaultPath: vault })

      await dispatcher.dispatch(buildOutboxEntry())
      await dispatcher.dispatch(buildOutboxEntry())

      const zettels = readdirSync(join(vault, "10_Zettels"))
      expect(zettels).toHaveLength(1)
    })
  })
})
