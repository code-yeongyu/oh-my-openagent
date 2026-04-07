declare const require: (name: string) => unknown
const { describe, test, expect, beforeEach } = require("bun:test") as {
  describe: (name: string, fn: () => void) => void
  test: (name: string, fn: () => void) => void
  expect: (value: unknown) => {
    toBe: (expected: unknown) => void
    toEqual: (expected: unknown) => void
    toBeUndefined: () => void
    toBeDefined: () => void
    toBeGreaterThan: (n: number) => void
  }
  beforeEach: (fn: () => void) => void
}

import {
  isExploreSubagent,
  getExploreCache,
  storeExploreCache,
  clearAllExploreCache,
  getExploreCacheStats,
  clearExploreCacheForSession,
} from "./explore-result-cache"

beforeEach(() => {
  clearAllExploreCache()
})

describe("explore-result-cache", () => {
  describe("isExploreSubagent", () => {
    test("returns true for explore", () => {
      expect(isExploreSubagent("explore")).toBe(true)
    })

    test("returns true for librarian", () => {
      expect(isExploreSubagent("librarian")).toBe(true)
    })

    test("returns true case-insensitively", () => {
      expect(isExploreSubagent("Explore")).toBe(true)
      expect(isExploreSubagent("LIBRARIAN")).toBe(true)
    })

    test("returns false for oracle", () => {
      expect(isExploreSubagent("oracle")).toBe(false)
    })

    test("returns false for undefined", () => {
      expect(isExploreSubagent(undefined)).toBe(false)
    })
  })

  describe("getExploreCache", () => {
    describe("#given no cached entry", () => {
      test("#then returns undefined", () => {
        const result = getExploreCache("session-1", "explore", "find auth patterns")
        expect(result).toBeUndefined()
      })
    })

    describe("#given a stored entry", () => {
      test("#then returns the cached result", () => {
        // given
        storeExploreCache("session-1", "explore", "find auth patterns", "auth.ts line 42")

        // when
        const result = getExploreCache("session-1", "explore", "find auth patterns")

        // then
        expect(result).toBe("auth.ts line 42")
      })

      test("#then prompt whitespace is normalized for cache lookup", () => {
        // given
        storeExploreCache("session-1", "explore", "find   auth   patterns", "result")

        // when
        const result = getExploreCache("session-1", "explore", "find auth patterns")

        // then
        expect(result).toBe("result")
      })

      test("#then leading/trailing whitespace is ignored", () => {
        // given
        storeExploreCache("session-1", "explore", "find auth", "result")

        // when
        const result = getExploreCache("session-1", "explore", "  find auth  ")

        // then
        expect(result).toBe("result")
      })
    })

    describe("#given entry from different session", () => {
      test("#then returns undefined", () => {
        // given
        storeExploreCache("session-A", "explore", "find auth", "result A")

        // when
        const result = getExploreCache("session-B", "explore", "find auth")

        // then
        expect(result).toBeUndefined()
      })
    })

    describe("#given different subagent types with same prompt", () => {
      test("#then each is cached independently", () => {
        // given
        storeExploreCache("session-1", "explore", "find X", "explore result")
        storeExploreCache("session-1", "librarian", "find X", "librarian result")

        // when
        const exploreResult = getExploreCache("session-1", "explore", "find X")
        const librarianResult = getExploreCache("session-1", "librarian", "find X")

        // then
        expect(exploreResult).toBe("explore result")
        expect(librarianResult).toBe("librarian result")
      })
    })
  })

  describe("storeExploreCache", () => {
    test("first-write wins on duplicate key", () => {
      // given
      storeExploreCache("session-1", "explore", "find auth", "first result")

      // when
      storeExploreCache("session-1", "explore", "find auth", "second result")
      const result = getExploreCache("session-1", "explore", "find auth")

      // then
      expect(result).toBe("first result")
    })
  })

  describe("getExploreCacheStats", () => {
    test("returns zero stats for unknown session", () => {
      const stats = getExploreCacheStats("nonexistent-session")
      expect(stats).toEqual({ entries: 0, totalHits: 0 })
    })

    test("tracks entry count and hit count", () => {
      // given
      storeExploreCache("session-1", "explore", "query A", "result A")
      storeExploreCache("session-1", "explore", "query B", "result B")
      getExploreCache("session-1", "explore", "query A")
      getExploreCache("session-1", "explore", "query A")

      // when
      const stats = getExploreCacheStats("session-1")

      // then
      expect(stats.entries).toBe(2)
      expect(stats.totalHits).toBe(2)
    })
  })

  describe("clearExploreCacheForSession", () => {
    test("removes only the targeted session", () => {
      // given
      storeExploreCache("session-A", "explore", "query", "result A")
      storeExploreCache("session-B", "explore", "query", "result B")

      // when
      clearExploreCacheForSession("session-A")

      // then
      expect(getExploreCache("session-A", "explore", "query")).toBeUndefined()
      expect(getExploreCache("session-B", "explore", "query")).toBe("result B")
    })
  })
})
