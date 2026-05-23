import { describe, it, expect, beforeEach } from "bun:test"
import {
  storeMemory,
  retrieveMemories,
  getRecentMemories,
  deleteMemory,
  clearAllMemories,
  getMemoryStats,
} from "./memory"
import { getMemoryDb } from "./storage"

describe("Semantic Memory", () => {
  beforeEach(() => {
    clearAllMemories()
  })

  describe("#given a clean database", () => {
    it("should store a memory", () => {
      // given
      const memory = {
        content: "Test memory content",
        type: "context" as const,
        tags: ["test", "memory"],
        sessionId: "session-1",
      }

      // when
      const id = storeMemory(memory)

      // then
      expect(id).toBeDefined()
      expect(id).toContain("memory-")
    })

    it("should retrieve memories by query", () => {
      // given
      storeMemory({
        content: "User prefers dark mode",
        type: "decision",
        tags: ["ui", "preference"],
        sessionId: "session-1",
      })

      storeMemory({
        content: "User likes light mode",
        type: "decision",
        tags: ["ui", "preference"],
        sessionId: "session-2",
      })

      // when
      const results = retrieveMemories("dark mode preference")

      // then
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toContain("dark mode")
    })

    it("should get recent memories", () => {
      // given
      storeMemory({
        content: "Recent memory 1",
        type: "context",
        tags: ["recent"],
        sessionId: "session-1",
      })

      storeMemory({
        content: "Recent memory 2",
        type: "context",
        tags: ["recent"],
        sessionId: "session-2",
      })

      // when
      const memories = getRecentMemories(5)

      // then
      expect(memories.length).toBe(2)
    })

    it("should delete a memory", () => {
      // given
      const id = storeMemory({
        content: "Memory to delete",
        type: "context",
        tags: ["delete"],
        sessionId: "session-1",
      })

      // when
      const deleted = deleteMemory(id)

      // then
      expect(deleted).toBe(true)
      const memories = getRecentMemories(10)
      expect(memories.length).toBe(0)
    })

    it("should get memory stats", () => {
      // given
      storeMemory({
        content: "Memory 1",
        type: "context",
        tags: ["stats"],
        sessionId: "session-1",
      })

      storeMemory({
        content: "Memory 2",
        type: "decision",
        tags: ["stats"],
        sessionId: "session-2",
      })

      // when
      const stats = getMemoryStats()

      // then
      expect(stats.totalMemories).toBe(2)
      expect(stats.byType.context).toBe(1)
      expect(stats.byType.decision).toBe(1)
    })

    it("should clear all memories", () => {
      // given
      storeMemory({
        content: "Memory 1",
        type: "context",
        tags: ["clear"],
        sessionId: "session-1",
      })

      // when
      clearAllMemories()

      // then
      const memories = getRecentMemories(10)
      expect(memories.length).toBe(0)
    })
  })
})
