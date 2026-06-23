/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { OutboxEntry } from "../types"
import { createDispatcherMultiplexer } from "./multiplexer"

function buildEntry(provider: string): OutboxEntry {
  return {
    outbox_id: `m:${provider}`,
    memory_id: "m_mux",
    provider_name: provider,
    operation: "create",
    idempotency_key: `k:${provider}`,
    status: "pending",
    created_at: "2026-04-19T00:00:00.000Z",
    retry_count: 0,
  }
}

describe("createDispatcherMultiplexer", () => {
  describe("#given no registered dispatchers", () => {
    test("#when dispatch is called #then throws", async () => {
      const mux = createDispatcherMultiplexer()
      await expect(mux.dispatch(buildEntry("obsidian"))).rejects.toThrow(
        "no dispatcher registered for provider: obsidian",
      )
    })
  })

  describe("#given a registered dispatcher", () => {
    test("#when dispatch matches provider #then underlying dispatcher is called", async () => {
      const mux = createDispatcherMultiplexer()
      const calls: OutboxEntry[] = []
      mux.register("obsidian", {
        async dispatch(entry) {
          calls.push(entry)
        },
      })

      await mux.dispatch(buildEntry("obsidian"))

      expect(calls).toHaveLength(1)
      expect(calls[0]?.provider_name).toBe("obsidian")
    })

    test("#when dispatch matches unregistered provider #then throws", async () => {
      const mux = createDispatcherMultiplexer()
      mux.register("obsidian", {
        async dispatch() {},
      })

      await expect(mux.dispatch(buildEntry("mem0"))).rejects.toThrow(
        "no dispatcher registered for provider: mem0",
      )
    })

    test("#when has checks registry #then reports accurately", () => {
      const mux = createDispatcherMultiplexer()
      mux.register("obsidian", {
        async dispatch() {},
      })

      expect(mux.has("obsidian")).toBe(true)
      expect(mux.has("mem0")).toBe(false)
    })
  })
})
