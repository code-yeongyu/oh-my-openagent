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
      const content = "Test memory content"
      const options = {
        memoryType: "context" as const,
        sessionId: "session-1",
      }

      // when
      const entry = storeMemory(content, options)

      // then
      expect(entry.id).toBeDefined()
      expect(entry.content).toBe(content)
      expect(entry.memoryType).toBe("context")
    })

    it("should retrieve memories by query", () => {
      // given
      storeMemory("User prefers dark mode", {
        memoryType: "decision",
        sessionId: "session-1",
      })

      storeMemory("User likes light mode", {
        memoryType: "decision",
        sessionId: "session-2",
      })

      // when
      const results = retrieveMemories({ query: "dark mode" })

      // then
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].entry.content).toBe("User prefers dark mode")
    })

    it("should get recent memories", () => {
      // given
      storeMemory("Recent memory 1", {
        memoryType: "context",
        sessionId: "session-1",
      })

      storeMemory("Recent memory 2", {
        memoryType: "context",
        sessionId: "session-2",
      })

      // when
      const memories = getRecentMemories(5)

      // then
      expect(memories.length).toBe(2)
    })

    it("should delete a memory", () => {
      // given
      const entry = storeMemory("Memory to delete", {
        memoryType: "context",
        sessionId: "session-1",
      })

      // when
      deleteMemory(entry.id)

      // then
      const memories = getRecentMemories(10)
      expect(memories.length).toBe(0)
    })

    it("should clear all memories", () => {
      // given
      storeMemory("Memory 1", {
        memoryType: "context",
        sessionId: "session-1",
      })

      storeMemory("Memory 2", {
        memoryType: "context",
        sessionId: "session-2",
      })

      // when
      clearAllMemories()

      // then
      const memories = getRecentMemories(10)
      expect(memories.length).toBe(0)
    })

    it("should get memory stats", () => {
      // given
      storeMemory("Memory 1", {
        memoryType: "context",
        sessionId: "session-1",
      })

      storeMemory("Memory 2", {
        memoryType: "decision",
        sessionId: "session-2",
      })

      // when
      const stats = getMemoryStats()

      // then
      expect(stats.totalMemories).toBe(2)
      expect(stats.byType["context"]).toBe(1)
      expect(stats.byType["decision"]).toBe(1)
    })
  })
})
