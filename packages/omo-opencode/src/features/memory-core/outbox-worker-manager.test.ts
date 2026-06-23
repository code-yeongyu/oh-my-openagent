/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MemoryCoreService } from "./service"
import type { OutboxEntry } from "./types"
import { OutboxWorkerManager } from "./outbox-worker-manager"

function buildEntry(provider: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    outbox_id: `m_test:${provider}`,
    memory_id: "m_test",
    provider_name: provider,
    operation: "create",
    idempotency_key: `k:${provider}`,
    status: "pending",
    created_at: "2026-04-19T00:00:00.000Z",
    retry_count: 0,
    ...overrides,
  }
}

function buildServiceStub(): {
  service: MemoryCoreService
  state: {
    pendingByProvider: Map<string, OutboxEntry[]>
    syncedIds: string[]
    failedIds: string[]
  }
} {
  const state = {
    pendingByProvider: new Map<string, OutboxEntry[]>(),
    syncedIds: [] as string[],
    failedIds: [] as string[],
  }

  const stub = {
    async getPendingOutbox(providerName: string, _limit: number) {
      return state.pendingByProvider.get(providerName) ?? []
    },
    async markOutboxSynced(outboxId: string) {
      state.syncedIds.push(outboxId)
      for (const entries of state.pendingByProvider.values()) {
        const idx = entries.findIndex((e) => e.outbox_id === outboxId)
        if (idx >= 0) entries.splice(idx, 1)
      }
    },
    async markOutboxFailed(outboxId: string, _error: string) {
      state.failedIds.push(outboxId)
    },
  } as unknown as MemoryCoreService

  return { service: stub, state }
}

describe("OutboxWorkerManager", () => {
  describe("#given a service with pending entries and a registered dispatcher", () => {
    test("#when start + poll #then dispatcher is called and entries marked synced", async () => {
      const { service, state } = buildServiceStub()
      state.pendingByProvider.set("obsidian", [buildEntry("obsidian")])

      const dispatched: OutboxEntry[] = []
      const manager = new OutboxWorkerManager({
        service,
        dispatcher: {
          async dispatch(entry) {
            dispatched.push(entry)
          },
        },
        providerNames: ["obsidian"],
        config: { pollIntervalMs: 10, batchSize: 10 },
      })

      manager.start()
      await new Promise((resolve) => setTimeout(resolve, 50))
      manager.stop()

      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]?.provider_name).toBe("obsidian")
      expect(state.syncedIds).toContain("m_test:obsidian")
    })
  })

  describe("#given a dispatcher that throws", () => {
    test("#when dispatched #then entry is marked failed", async () => {
      const { service, state } = buildServiceStub()
      state.pendingByProvider.set("obsidian", [buildEntry("obsidian")])

      const manager = new OutboxWorkerManager({
        service,
        dispatcher: {
          async dispatch() {
            throw new Error("boom")
          },
        },
        providerNames: ["obsidian"],
        config: { pollIntervalMs: 10, batchSize: 10, maxRetries: 1 },
      })

      manager.start()
      await new Promise((resolve) => setTimeout(resolve, 50))
      manager.stop()

      expect(state.failedIds).toContain("m_test:obsidian")
    })
  })

  describe("#given multiple provider names", () => {
    test("#when started #then each provider has its own worker state", () => {
      const { service } = buildServiceStub()
      const manager = new OutboxWorkerManager({
        service,
        dispatcher: {
          async dispatch() {},
        },
        providerNames: ["obsidian", "mem0"],
      })

      const states = manager.getStates()
      expect(Object.keys(states).sort()).toEqual(["mem0", "obsidian"])
    })
  })

  describe("#given manager is stopped without start", () => {
    test("#when stop called #then no error thrown", () => {
      const { service } = buildServiceStub()
      const manager = new OutboxWorkerManager({
        service,
        dispatcher: {
          async dispatch() {},
        },
        providerNames: ["obsidian"],
      })

      expect(() => manager.stop()).not.toThrow()
    })
  })
})
