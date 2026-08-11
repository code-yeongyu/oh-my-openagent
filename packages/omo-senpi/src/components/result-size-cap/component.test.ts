import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createResultSizeCapComponent } from "./component"

function recordingLogger(): ComponentLogger & { entries: Array<{ message: string; details?: unknown }> } {
  const entries: Array<{ message: string; details?: unknown }> = []
  return {
    entries,
    info(message, details) {
      entries.push({ message, details })
    },
    warn() {},
    error() {},
  }
}

async function register(options: Parameters<typeof createResultSizeCapComponent>[0] = {}) {
  const pi = new FakeExtensionAPI()
  const logger = recordingLogger()
  await createResultSizeCapComponent(options).register(pi, { logger, config: { getFlag: () => false } })
  return { pi, logger }
}

describe("result-size-cap component", () => {
  it("caps a built-in tool_result before admission and emits one metadata-only event", async () => {
    const { pi, logger } = await register({ thresholdBytes: 100, aggregateThresholdBytes: 100, headChars: 8, tailChars: 4 })
    const secret = "SECRET_MIDDLE_SENTINEL"
    const results = await pi.dispatch("tool_result", {
      type: "tool_result",
      toolName: "apply_patch",
      content: [{ type: "text", text: `HEAD${"x".repeat(5000)}${secret}TAIL` }],
      details: { stable: true },
      isError: false,
    })

    expect(results).toHaveLength(1)
    const result = results[0] as { content: Array<{ text: string }>; details: unknown; isError: boolean }
    expect(result.content[0]?.text).toContain("<truncated:")
    expect(result.content[0]?.text).not.toContain(secret)
    expect(result.details).toEqual({ stable: true })
    expect(result.isError).toBe(false)
    expect(logger.entries).toHaveLength(1)
    expect(logger.entries[0]?.message).toBe("omo-senpi tool result capped")
    expect(JSON.stringify(logger.entries[0]?.details)).not.toContain(secret)
    expect(logger.entries[0]?.details).toMatchObject({ toolName: "apply_patch", perBlockCapped: true })
  })

  it("caps aggregate text from many sub-threshold blocks while preserving non-text blocks", async () => {
    const { pi, logger } = await register({ thresholdBytes: 100, aggregateThresholdBytes: 100, headChars: 8, tailChars: 8 })
    const image = { type: "image", data: "opaque" }
    const results = await pi.dispatch("tool_result", {
      type: "tool_result",
      toolName: "bash",
      content: [{ type: "text", text: "a".repeat(70) }, image, { type: "text", text: "b".repeat(70) }],
    })

    const result = results[0] as { content: Array<{ type: string; text?: string }> }
    expect(result.content.filter((block) => block.type === "text")).toHaveLength(1)
    expect(result.content.some((block) => block === image)).toBe(true)
    expect(logger.entries[0]?.details).toMatchObject({ aggregateCapped: true, originalTextBlocks: 2, emittedTextBlocks: 1 })
  })

  it("returns no replacement and emits no event for small results", async () => {
    const { pi, logger } = await register({ thresholdBytes: 100, aggregateThresholdBytes: 100 })
    const results = await pi.dispatch("tool_result", {
      type: "tool_result",
      toolName: "bash",
      content: [{ type: "text", text: "ok" }],
    })
    expect(results).toEqual([undefined])
    expect(logger.entries).toEqual([])
  })

  it("preserves error and usage metadata on a capped replacement", async () => {
    const { pi } = await register({ thresholdBytes: 100, aggregateThresholdBytes: 100 })
    const usage = { input: 1, output: 2 }
    const results = await pi.dispatch("tool_result", {
      type: "tool_result",
      toolName: "bash",
      content: [{ type: "text", text: "x".repeat(5000) }],
      isError: true,
      usage,
    })
    expect(results[0]).toMatchObject({ isError: true, usage })
  })

  it("ignores malformed events", async () => {
    const { pi, logger } = await register()
    expect(await pi.dispatch("tool_result", { type: "tool_result", content: "not-an-array" })).toEqual([undefined])
    expect(logger.entries).toEqual([])
  })
})
