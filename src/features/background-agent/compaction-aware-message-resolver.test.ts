import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { isCompactionAgent, findNearestMessageExcludingCompaction } from "./compaction-aware-message-resolver"

describe("isCompactionAgent", () => {
  describe("#given agent name variations", () => {
    test("returns true for 'compaction'", () => {
      // when
      const result = isCompactionAgent("compaction")

      // then
      expect(result).toBe(true)
    })

    test("returns true for 'Compaction' (case insensitive)", () => {
      // when
      const result = isCompactionAgent("Compaction")

      // then
      expect(result).toBe(true)
    })

    test("returns true for ' compaction ' (with whitespace)", () => {
      // when
      const result = isCompactionAgent(" compaction ")

      // then
      expect(result).toBe(true)
    })

    test("returns false for undefined", () => {
      // when
      const result = isCompactionAgent(undefined)

      // then
      expect(result).toBe(false)
    })

    test("returns false for null", () => {
      // when
      const result = isCompactionAgent(null as unknown as string)

      // then
      expect(result).toBe(false)
    })

    test("returns false for non-compaction agent like 'sisyphus'", () => {
      // when
      const result = isCompactionAgent("sisyphus")

      // then
      expect(result).toBe(false)
    })
  })
})

describe("findNearestMessageExcludingCompaction", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "compaction-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true })
  })

  describe("#given directory with messages", () => {
    test("finds message with full agent and model", () => {
      // given
      const message = {
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      }
      writeFileSync(join(tempDir, "001.json"), JSON.stringify(message))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).not.toBeNull()
      expect(result?.agent).toBe("sisyphus")
      expect(result?.model?.providerID).toBe("anthropic")
      expect(result?.model?.modelID).toBe("claude-opus-4-6")
    })

    test("skips compaction agent messages", () => {
      // given
      const compactionMessage = {
        agent: "compaction",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      }
      const validMessage = {
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      }
      writeFileSync(join(tempDir, "001.json"), JSON.stringify(compactionMessage))
      writeFileSync(join(tempDir, "002.json"), JSON.stringify(validMessage))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).not.toBeNull()
      expect(result?.agent).toBe("sisyphus")
    })

    test("falls back to partial agent/model match", () => {
      // given
      const messageWithAgentOnly = {
        agent: "hephaestus",
      }
      const messageWithModelOnly = {
        model: { providerID: "openai", modelID: "gpt-5.3" },
      }
      writeFileSync(join(tempDir, "001.json"), JSON.stringify(messageWithModelOnly))
      writeFileSync(join(tempDir, "002.json"), JSON.stringify(messageWithAgentOnly))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).not.toBeNull()
      // Should find the one with agent first (sorted reverse, so 002 is checked first)
      expect(result?.agent).toBe("hephaestus")
    })

    test("returns null for empty directory", () => {
      // given - empty directory (tempDir is already empty)

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).toBeNull()
    })

    test("returns null for non-existent directory", () => {
      // given
      const nonExistentDir = join(tmpdir(), "non-existent-dir-12345")

      // when
      const result = findNearestMessageExcludingCompaction(nonExistentDir)

      // then
      expect(result).toBeNull()
    })

    test("skips invalid JSON files and finds valid message", () => {
      // given
      const invalidJson = "{ invalid json"
      const validMessage = {
        agent: "oracle",
        model: { providerID: "google", modelID: "gemini-2-flash" },
      }
      writeFileSync(join(tempDir, "001.json"), invalidJson)
      writeFileSync(join(tempDir, "002.json"), JSON.stringify(validMessage))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).not.toBeNull()
      expect(result?.agent).toBe("oracle")
    })

    test("finds newest valid message (sorted by filename reverse)", () => {
      // given
      const olderMessage = {
        agent: "older",
        model: { providerID: "a", modelID: "b" },
      }
      const newerMessage = {
        agent: "newer",
        model: { providerID: "c", modelID: "d" },
      }
      writeFileSync(join(tempDir, "001.json"), JSON.stringify(olderMessage))
      writeFileSync(join(tempDir, "010.json"), JSON.stringify(newerMessage))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).not.toBeNull()
      expect(result?.agent).toBe("newer")
    })
  })
})
