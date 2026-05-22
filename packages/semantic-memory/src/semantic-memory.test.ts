import { describe, it, expect, beforeEach } from "bun:test"
import {
  storeMemory,
  retrieveMemories,
  getRecentMemories,
  deleteMemory,
  clearAllMemories,
  getMemoryStats,
  closeMemoryDb,
} from "./index"

describe("semantic-memory", () => {
  beforeEach(() => {
    clearAllMemories()
  })

  describe("#given empty memory", () => {
    it("#then getMemoryStats returns zeros", () => {
      const stats = getMemoryStats()
      expect(stats.totalMemories).toBe(0)
      expect(stats.avgImportance).toBe(0)
    })

    it("#then retrieveMemories returns empty array", () => {
      const results = retrieveMemories({ query: "test" })
      expect(results).toHaveLength(0)
    })
  })

  describe("#given stored memories", () => {
    beforeEach(() => {
      storeMemory("User wants to implement authentication with JWT tokens", {
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "context",
        importance: 1.5,
      })

      storeMemory("Successfully delegated task to oracle for architecture review", {
        agentName: "sisyphus",
        sessionId: "session-1",
        memoryType: "decision",
        importance: 2.0,
      })

      storeMemory("Error: database connection timeout when querying large dataset", {
        agentName: "atlas",
        sessionId: "session-2",
        memoryType: "error",
        importance: 1.8,
      })

      storeMemory("Pattern: always validate input before processing", {
        agentName: "oracle",
        sessionId: "session-3",
        memoryType: "pattern",
        importance: 2.5,
      })
    })

    it("#then getMemoryStats returns correct counts", () => {
      const stats = getMemoryStats()
      expect(stats.totalMemories).toBe(4)
      expect(stats.byType["context"]).toBe(1)
      expect(stats.byType["decision"]).toBe(1)
      expect(stats.byType["error"]).toBe(1)
      expect(stats.byType["pattern"]).toBe(1)
      expect(stats.byAgent["sisyphus"]).toBe(2)
      expect(stats.byAgent["atlas"]).toBe(1)
      expect(stats.byAgent["oracle"]).toBe(1)
    })

    it("#then retrieveMemories finds relevant memories by query", () => {
      const results = retrieveMemories({ query: "authentication JWT" })
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].entry.content).toContain("authentication")
    })

    it("#then retrieveMemories filters by agent", () => {
      const results = retrieveMemories({ query: "task", agentName: "sisyphus" })
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].entry.agentName).toBe("sisyphus")
    })

    it("#then retrieveMemories filters by memory type", () => {
      const results = retrieveMemories({ query: "error", memoryType: "error" })
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].entry.memoryType).toBe("error")
    })

    it("#then retrieveMemories limits results", () => {
      const results = retrieveMemories({ query: "the", limit: 2 })
      expect(results).toHaveLength(2)
    })

    it("#then getRecentMemories returns memories ordered by date", () => {
      const results = getRecentMemories({ limit: 2 })
      expect(results).toHaveLength(2)
    })

    it("#then deleteMemory removes a memory", () => {
      const memories = getRecentMemories({ limit: 1 })
      const id = memories[0].id

      const deleted = deleteMemory(id)
      expect(deleted).toBe(true)

      const stats = getMemoryStats()
      expect(stats.totalMemories).toBe(3)
    })

    it("#then retrieveMemories updates access count", () => {
      const results = retrieveMemories({ query: "authentication" })
      expect(results[0].entry.accessCount).toBe(1)

      // Retrieve again
      const results2 = retrieveMemories({ query: "authentication" })
      expect(results2[0].entry.accessCount).toBe(2)
    })

    it("#then retrieveMemories filters by minImportance", () => {
      const results = retrieveMemories({ query: "the", minImportance: 2.0 })
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.entry.importance).toBeGreaterThanOrEqual(2.0)
      }
    })
  })

  describe("#given cosine similarity", () => {
    it("#then identical vectors have similarity 1", () => {
      const { cosineSimilarity } = require("./types")
      const a = [1, 0, 0]
      const b = [1, 0, 0]
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
    })

    it("#then orthogonal vectors have similarity 0", () => {
      const { cosineSimilarity } = require("./types")
      const a = [1, 0, 0]
      const b = [0, 1, 0]
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
    })
  })
})
