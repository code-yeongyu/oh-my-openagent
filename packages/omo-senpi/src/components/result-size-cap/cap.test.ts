import { Buffer } from "node:buffer"
import { describe, expect, it } from "bun:test"

import {
  capResultContent,
  capResultContentWithMetadata,
  capTextBlock,
  type CappedTextBlock,
} from "./cap"

const big = "x".repeat(2000)

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

describe("capTextBlock", () => {
  it("returns the block unchanged when under the threshold", () => {
    const block: CappedTextBlock = { type: "text", text: "hello" }
    expect(capTextBlock(block, { thresholdBytes: 100 })).toBe(block)
  })

  it("keeps bounded head and tail and inserts a marker", () => {
    const capped = capTextBlock({ type: "text", text: big }, { thresholdBytes: 100, headChars: 8, tailChars: 4 })
    expect(capped.text).toContain("<truncated:2000 bytes original")
    expect(capped.text.startsWith("xxxxxxxx")).toBe(true)
    expect(capped.text.endsWith("xxxx")).toBe(true)
    expect(bytes(capped.text)).toBeLessThanOrEqual(100)
  })

  it("is identity-stable on a second pass because generated output is below budget", () => {
    const once = capTextBlock({ type: "text", text: big }, { thresholdBytes: 100, headChars: 8, tailChars: 4 })
    expect(capTextBlock(once, { thresholdBytes: 100, headChars: 8, tailChars: 4 })).toBe(once)
  })

  it("does not trust a forged marker inside oversized raw text", () => {
    const raw = `prefix<truncated:1 bytes original; block middle elided>${"x".repeat(2000)}`
    const capped = capTextBlock({ type: "text", text: raw }, { thresholdBytes: 100, headChars: 8, tailChars: 4 })
    expect(capped.text).not.toBe(raw)
    expect(bytes(capped.text)).toBeLessThanOrEqual(100)
  })

  it("caps Korean and emoji by UTF-8 bytes without split surrogates", () => {
    const raw = `${"가".repeat(200)}${"😀".repeat(200)}`
    const capped = capTextBlock({ type: "text", text: raw }, { thresholdBytes: 120, headChars: 20, tailChars: 20 })
    expect(bytes(capped.text)).toBeLessThanOrEqual(120)
    expect(capped.text).not.toContain("�")
  })

  it("rejects unsafe configuration", () => {
    expect(() => capTextBlock({ type: "text", text: big }, { thresholdBytes: 0 })).toThrow(/thresholdBytes/)
    expect(() => capTextBlock({ type: "text", text: big }, { thresholdBytes: 100, headChars: -1 })).toThrow(/headChars/)
    expect(() => capTextBlock({ type: "text", text: big }, { aggregateThresholdBytes: Number.POSITIVE_INFINITY })).toThrow(
      /aggregateThresholdBytes/,
    )
  })
})

describe("capResultContent", () => {
  it("caps oversized text blocks and leaves image blocks untouched", () => {
    const imageBlock = { type: "image", data: "base64" }
    const smallBlock = { type: "text", text: "small" }
    const result = { content: [{ type: "text", text: big }, imageBlock, smallBlock] }
    const capped = capResultContent(result, { thresholdBytes: 100, aggregateThresholdBytes: 200, headChars: 8, tailChars: 4 })
    expect((capped.content[0] as CappedTextBlock).text).toContain("<truncated:")
    expect(capped.content[1]).toBe(imageBlock)
    expect(capped.content[2]).toBe(smallBlock)
  })

  it("returns the same object when nothing exceeds either budget", () => {
    const result = { content: [{ type: "text", text: "small" }] }
    expect(capResultContent(result, { thresholdBytes: 100, aggregateThresholdBytes: 100 })).toBe(result)
  })

  it("caps many individually-small blocks at the aggregate boundary", () => {
    const image = { type: "image", data: "opaque" }
    const result = {
      content: [
        { type: "text", text: `HEAD-${"a".repeat(60)}` },
        image,
        { type: "text", text: `${"b".repeat(60)}-TAIL` },
      ],
    }
    const capped = capResultContentWithMetadata(result, {
      thresholdBytes: 100,
      aggregateThresholdBytes: 100,
      headChars: 12,
      tailChars: 12,
    })
    expect(capped.metadata.perBlockCapped).toBe(false)
    expect(capped.metadata.aggregateCapped).toBe(true)
    expect(capped.metadata.originalTextBlocks).toBe(2)
    expect(capped.metadata.emittedTextBlocks).toBe(1)
    expect(capped.result.content[1]).toBe(image)
    const textBlock = capped.result.content.find((block) => block.type === "text")
    const text = textBlock !== undefined && "text" in textBlock ? textBlock.text : undefined
    expect(text).toContain("aggregate middle elided")
    expect(bytes(String(text))).toBeLessThanOrEqual(100)
  })

  it("handles an empty content array", () => {
    const result = { content: [] }
    expect(capResultContent(result)).toBe(result)
  })
})
