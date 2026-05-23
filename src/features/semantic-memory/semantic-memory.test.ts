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
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "context" as const,
      }

      // when
      const memory = storeMemory(content, options)

      // then
      expect(memory.id).toBeDefined()
      expect(memory.content).toBe(content)
      expect(memory.memoryType).toBe("context")
    })

    it("should retrieve memories by query", () => {
      // given
      storeMemory("User prefers dark mode", {
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "decision",
      })

      storeMemory("User likes light mode", {
        agentName: "sisyphus",
        sessionId: "session-2",
        memoryType: "decision",
      })

      // when
      const results = retrieveMemories({ query: "dark mode preference" })

      // then
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].entry.content).toContain("dark mode")
    })

    it("should get recent memories", () => {
      // given
      storeMemory("Recent memory 1", {
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "context",
      })

      storeMemory("Recent memory 2", {
        agentName: "sisyphus",
        sessionId: "session-2",
        memoryType: "context",
      })

      // when
      const memories = getRecentMemories(5)

      // then
      expect(memories.length).toBe(2)
    })

    it("should delete a memory", () => {
      // given
      const memory = storeMemory("Memory to delete", {
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "context",
      })

      // when
      const deleted = deleteMemory(memory.id)

      // then
      expect(deleted).toBe(true)
      const memories = getRecentMemories(10)
      expect(memories.length).toBe(0)
    })

    it("should get memory stats", () => {
      // given
      storeMemory("Memory 1", {
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "context",
      })

      storeMemory("Memory 2", {
        agentName: "sisyphus",
        sessionId: "session-2",
        memoryType: "decision",
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
      storeMemory("Memory 1", {
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "context",
      })

      // when
      clearAllMemories()

      // then
      const memories = getRecentMemories(10)
      expect(memories.length).toBe(0)
    })
  })
})
