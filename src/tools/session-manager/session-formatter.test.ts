/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import type { SearchResult } from "./types"

// Helper to create mock search results
function createMockSearchResults(count: number): SearchResult[] {
  const results: SearchResult[] = []
  for (let i = 0; i < count; i++) {
    results.push({
      session_id: `ses_${String(i + 1).padStart(3, "0")}`,
      message_id: `msg_${String(i + 1).padStart(3, "0")}`,
      role: i % 2 === 0 ? "user" : "assistant",
      excerpt: `This is a long excerpt with some content to make the output larger for testing compression. Match found at position ${i}.`,
      match_count: Math.floor(Math.random() * 5) + 1,
      timestamp: Date.now() - i * 1000,
    })
  }
  return results
}

describe("formatSearchResults", () => {
  describe("#given empty results", () => {
    describe("#when formatting", () => {
      test("#then returns no matches message", async () => {
        const { formatSearchResults } = await import("./session-formatter")
        const result = formatSearchResults([])

        expect(result).toBe("No matches found.")
      })
    })
  })

  describe("#given small results list", () => {
    describe("#when formatting without compression", () => {
      test("#then returns formatted text", async () => {
        const { formatSearchResults } = await import("./session-formatter")
        const results = createMockSearchResults(3)

        const formatted = formatSearchResults(results, { enabled: false, threshold: 5000 })

        expect(formatted).toContain("Found 3 matches")
        expect(formatted).toContain("ses_001")
      })
    })

    describe("#when formatting with compression enabled but output small", () => {
      test("#then returns formatted text not compressed", async () => {
        const { formatSearchResults } = await import("./session-formatter")
        const results = createMockSearchResults(3)

        const formatted = formatSearchResults(results, { enabled: true, threshold: 5000 })

        expect(formatted).toContain("Found 3 matches")
      })
    })
  })

  describe("#given large results list exceeding threshold", () => {
    describe("#when compression is enabled", () => {
      test("#then returns compressed TOON format", async () => {
        const { formatSearchResults } = await import("./session-formatter")
        const results = createMockSearchResults(100)

        const formatted = formatSearchResults(results, { enabled: true, threshold: 1000 })

        // Real TOON library produces toon: prefix when compression is attempted
        expect(formatted).toContain("toon:")
        // Verify the data structure is preserved in the output
        expect(formatted).toContain("session_id")
        expect(formatted).toContain("ses_001")
      })
    })

    describe("#when compression is disabled", () => {
      test("#then returns formatted text", async () => {
        const { formatSearchResults } = await import("./session-formatter")
        const results = createMockSearchResults(100)

        const formatted = formatSearchResults(results, { enabled: false, threshold: 1000 })

        expect(formatted).toContain("Found 100 matches")
      })
    })
  })

  describe("#given results with error-like content", () => {
    describe("#when compression is enabled", () => {
      test("#then does not compress error content", async () => {
        const { formatSearchResults } = await import("./session-formatter")
        const results: SearchResult[] = [
          {
            session_id: "ses_001",
            message_id: "msg_001",
            role: "assistant",
            excerpt: "Error: Something failed with stack trace",
            match_count: 1,
          },
        ]

        const formatted = formatSearchResults(results, { enabled: true, threshold: 10 })

        // Error-like content should not be compressed
        expect(formatted).toContain("Error: Something failed")
      })
    })
  })
})

describe("formatSessionList", () => {
  describe("#given empty session list", () => {
    describe("#when formatting", () => {
      test("#then returns no sessions message", async () => {
        const { formatSessionList } = await import("./session-formatter")
        const result = await formatSessionList([])

        expect(result).toBe("No sessions found.")
      })
    })
  })

  describe("#given config parameter", () => {
    describe("#when called with compression config", () => {
      test("#then function accepts config without error", async () => {
        const { formatSessionList } = await import("./session-formatter")
        // This test verifies the function signature accepts the config
        // Even with empty array, it should work
        const result = await formatSessionList([], { enabled: true, threshold: 5000 })

        expect(result).toBe("No sessions found.")
      })
    })
  })
})
