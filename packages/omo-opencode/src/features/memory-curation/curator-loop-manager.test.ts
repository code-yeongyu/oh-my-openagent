/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MemoryCoreService } from "../memory-core/service"
import { CuratorLoopManager } from "./curator-loop-manager"
import type { CuratorInvoker } from "./invoker"

function buildServiceStub(): MemoryCoreService {
  return {
    async search() {
      return { memories: [], total: 0 }
    },
    async get() {
      return undefined
    },
    async update() {
      return {}
    },
    async archive() {},
    async enqueueOutbox() {},
    async appendAuditLog() {},
  } as unknown as MemoryCoreService
}

function buildInvokerStub(): CuratorInvoker {
  return {
    async invoke() {
      return { decisions: [], summary: "", warnings: [] }
    },
  }
}

describe("CuratorLoopManager", () => {
  describe("#given a new manager", () => {
    test("#when getState is called before start #then state is not running and tickCount is 0", () => {
      const manager = new CuratorLoopManager({
        service: buildServiceStub(),
        invoker: buildInvokerStub(),
      })
      const state = manager.getState()
      expect(state.isRunning).toBe(false)
      expect(state.tickCount).toBe(0)
    })
  })

  describe("#given a started manager", () => {
    test("#when start + stop are called #then state transitions correctly", () => {
      const manager = new CuratorLoopManager({
        service: buildServiceStub(),
        invoker: buildInvokerStub(),
        config: { intervalMs: 1_000_000 },
      })
      manager.start()
      expect(manager.getState().isRunning).toBe(true)
      manager.stop()
      expect(manager.getState().isRunning).toBe(false)
    })
  })

  describe("#given runOnce is called", () => {
    test("#when tick completes #then tickCount reflects the run", async () => {
      const manager = new CuratorLoopManager({
        service: buildServiceStub(),
        invoker: buildInvokerStub(),
      })
      await manager.runOnce()
      expect(manager.getState().tickCount).toBe(1)
    })
  })
})
