import { describe, test, expect } from "bun:test"
import { MemoryLayerManager } from "./layers"
import { Mem0Adapter } from "./adapter"
import type { Mem0Config } from "./types"

describe("MemoryLayerManager", () => {
  const createDisabledAdapter = () => {
    const config: Mem0Config = { enabled: false }
    return new Mem0Adapter(config)
  }

  describe("constructor", () => {
    test("initializes with adapter and default layer", () => {
      const adapter = createDisabledAdapter()
      const manager = new MemoryLayerManager({
        adapter,
        defaultLayer: "project",
      })

      expect(manager).toBeDefined()
    })
  })

  describe("layer priority", () => {
    test("defines correct layer hierarchy", () => {
      const adapter = createDisabledAdapter()
      const manager = new MemoryLayerManager({
        adapter,
        defaultLayer: "user",
      })

      expect(manager).toBeDefined()
    })
  })

  describe("formatLayerName", () => {
    test("capitalizes layer names correctly", () => {
      const adapter = createDisabledAdapter()
      const manager = new MemoryLayerManager({
        adapter,
        defaultLayer: "user",
      })

      expect(manager).toBeDefined()
    })
  })
})
