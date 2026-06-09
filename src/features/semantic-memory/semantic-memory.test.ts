import { describe, it, expect, beforeEach } from "bun:test"
import {
  storeMemory,
  retrieveMemories,
  getRecentMemories,
  deleteMemory,
  clearAllMemories,
  getMemoryStats,
} from "./memory"

describe("Semantic Memory", () => {
  beforeEach(async () => {
    await clearAllMemories()
  })

  describe("#given a clean database", () => {
    it("should store a memory", async () => {
      // given
      const content = "Test memory content"
      const options = {
        memoryType: "context" as const,
        sessionId: "session-1",
      }

      // when
      const entry = await storeMemory(content, options)

      // then
      expect(entry.id).toBeDefined()
      expect(entry.content).toBe(content)
      expect(entry.memoryType).toBe("context")
    })

    it("should retrieve memories by query", async () => {
      // given
      await storeMemory("User prefers dark mode", {
        memoryType: "decision",
        sessionId: "session-1",
      })

      await storeMemory("User likes light mode", {
        memoryType: "decision",
        sessionId: "session-2",
      })

      // when
      const results = await retrieveMemories({ query: "dark mode" })

      // then
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].entry.content).toBe("User prefers dark mode")
    })

    it("should get recent memories", async () => {
      // given
      await storeMemory("Recent memory 1", {
        memoryType: "context",
        sessionId: "session-1",
      })

      await storeMemory("Recent memory 2", {
        memoryType: "context",
        sessionId: "session-2",
      })

      // when
      const memories = await getRecentMemories({ limit: 5 })

      // then
      expect(memories.length).toBe(2)
    })

    it("should delete a memory", async () => {
      // given
      const entry = await storeMemory("Memory to delete", {
        memoryType: "context",
        sessionId: "session-1",
      })

      // when
      await deleteMemory(entry.id)

      // then
      const memories = await getRecentMemories({ limit: 10 })
      expect(memories.length).toBe(0)
    })

    it("should clear all memories", async () => {
      // given
      await storeMemory("Memory 1", {
        memoryType: "context",
        sessionId: "session-1",
      })

      await storeMemory("Memory 2", {
        memoryType: "context",
        sessionId: "session-2",
      })

      // when
      await clearAllMemories()

      // then
      const memories = await getRecentMemories({ limit: 10 })
      expect(memories.length).toBe(0)
    })

    it("should get memory stats", async () => {
      // given
      await storeMemory("Memory 1", {
        memoryType: "context",
        sessionId: "session-1",
      })

      await storeMemory("Memory 2", {
        memoryType: "decision",
        sessionId: "session-2",
      })

      // when
      const stats = await getMemoryStats()

      // then
      expect(stats.totalMemories).toBe(2)
      expect(stats.byType["context"]).toBe(1)
      expect(stats.byType["decision"]).toBe(1)
    })
  })
})
