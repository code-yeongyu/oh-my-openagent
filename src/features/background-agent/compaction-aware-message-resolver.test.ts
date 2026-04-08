import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  isCompactionAgent,
  findNearestMessageExcludingCompaction,
  resolvePromptContextFromSessionMessages,
} from "./compaction-aware-message-resolver"
import {
  clearCompactionAgentConfigCheckpoint,
  setCompactionAgentConfigCheckpoint,
} from "../../shared/compaction-agent-config-checkpoint"
import { PART_STORAGE } from "../../shared"

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
    rmSync(join(PART_STORAGE, "msg_test_background_compaction_marker"), { force: true, recursive: true })
    clearCompactionAgentConfigCheckpoint("ses_checkpoint")
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
      writeFileSync(join(tempDir, "002.json"), JSON.stringify(compactionMessage))
      writeFileSync(join(tempDir, "001.json"), JSON.stringify(validMessage))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).not.toBeNull()
      expect(result?.agent).toBe("sisyphus")
    })

    test("skips JSON messages whose part storage contains a compaction marker", () => {
      // given
      const compactionMessageID = "msg_test_background_compaction_marker"
      const partDir = join(PART_STORAGE, compactionMessageID)
      writeFileSync(join(tempDir, "002.json"), JSON.stringify({
        id: compactionMessageID,
        agent: "atlas",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      }))
      writeFileSync(join(tempDir, "001.json"), JSON.stringify({
        id: "msg_001",
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      }))
      mkdirSync(partDir, { recursive: true })
      writeFileSync(join(partDir, "prt_0001.json"), JSON.stringify({ type: "compaction" }))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
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
      writeFileSync(join(tempDir, "002.json"), invalidJson)
      writeFileSync(join(tempDir, "001.json"), JSON.stringify(validMessage))

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

    test("merges partial metadata from multiple recent messages", () => {
      // given
      writeFileSync(
        join(tempDir, "003.json"),
        JSON.stringify({ model: { providerID: "anthropic", modelID: "claude-opus-4-1" } }),
      )
      writeFileSync(join(tempDir, "002.json"), JSON.stringify({ agent: "atlas" }))
      writeFileSync(join(tempDir, "001.json"), JSON.stringify({ tools: { bash: true } }))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir)

      // then
      expect(result).toEqual({
        agent: "atlas",
        model: { providerID: "anthropic", modelID: "claude-opus-4-1" },
        tools: { bash: true },
      })
    })

    test("fills missing metadata from compaction checkpoint", () => {
      // given
      setCompactionAgentConfigCheckpoint("ses_checkpoint", {
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5" },
      })
      writeFileSync(join(tempDir, "001.json"), JSON.stringify({ tools: { bash: true } }))

      // when
      const result = findNearestMessageExcludingCompaction(tempDir, "ses_checkpoint")

      // then
      expect(result).toEqual({
        agent: "sisyphus",
        model: { providerID: "openai", modelID: "gpt-5" },
        tools: { bash: true },
      })
    })
  })
})

describe("resolvePromptContextFromSessionMessages", () => {
  test("merges partial prompt context from recent SDK messages", () => {
    // given
    const messages = [
      { info: { agent: "atlas" } },
      { info: { model: { providerID: "anthropic", modelID: "claude-opus-4-1" } } },
      { info: { tools: { bash: true } } },
    ]

    // when
    const result = resolvePromptContextFromSessionMessages(messages)

    // then
    expect(result).toEqual({
      agent: "atlas",
      model: { providerID: "anthropic", modelID: "claude-opus-4-1" },
      tools: { bash: true },
    })
  })

  test("skips SDK messages that only exist to mark compaction", () => {
    // given
    const messages = [
      {
        id: "msg_compaction",
        info: { agent: "atlas", model: { providerID: "openai", modelID: "gpt-5" } },
        parts: [{ type: "compaction" }],
      },
      { info: { agent: "sisyphus" } },
      { info: { model: { providerID: "anthropic", modelID: "claude-opus-4-1" } } },
      { info: { tools: { bash: true } } },
    ]

    // when
    const result = resolvePromptContextFromSessionMessages(messages)

    // then
    expect(result).toEqual({
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-1" },
      tools: { bash: true },
    })
  })
})
