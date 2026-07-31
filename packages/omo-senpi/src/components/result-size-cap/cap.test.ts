import { describe, expect, it } from "bun:test"

import { capResultContent, capTextBlock, type CappedTextBlock } from "./cap"

const big = "x".repeat(2000)

describe("capTextBlock", () => {
  it("returns the block unchanged when under the threshold", () => {
    const block: CappedTextBlock = { type: "text", text: "hello" }
    expect(capTextBlock(block, { thresholdBytes: 100 })).toBe(block)
  })

  it("keeps the head and tail and inserts a marker when over the threshold", () => {
    const capped = capTextBlock({ type: "text", text: big }, { thresholdBytes: 100, headChars: 8, tailChars: 4 })
    expect(capped.text).toContain("<truncated:2000 bytes original")
    expect(capped.text.startsWith("xxxxxxxx")).toBe(true)
    expect(capped.text.endsWith("xxxx")).toBe(true)
    expect(capped.text.length).toBeLessThan(200)
  })

  it("does not re-cap an already-capped block", () => {
    const once = capTextBlock({ type: "text", text: big }, { thresholdBytes: 100, headChars: 8, tailChars: 4 })
    const twice = capTextBlock(once, { thresholdBytes: 100, headChars: 8, tailChars: 4 })
    expect(twice).toBe(once)
  })

  it("caps by utf8 bytes, not characters", () => {
    const korean = "가".repeat(2000)
    const capped = capTextBlock({ type: "text", text: korean }, { thresholdBytes: 100, headChars: 4, tailChars: 2 })
    expect(capped.text).toContain("<truncated:")
  })
})

describe("capResultContent", () => {
  it("caps oversized text blocks and leaves image blocks untouched", () => {
    const imageBlock = { type: "image", data: "base64" }
    const smallBlock = { type: "text", text: "small" }
    const result = { content: [{ type: "text", text: big }, imageBlock, smallBlock] }
    const capped = capResultContent(result, { thresholdBytes: 100, headChars: 8, tailChars: 4 })
    expect((capped.content[0] as CappedTextBlock).text).toContain("<truncated:")
    expect(capped.content[1]).toBe(imageBlock)
    expect(capped.content[2]).toBe(smallBlock)
  })

  it("returns the same object when nothing exceeds the threshold", () => {
    const result = { content: [{ type: "text", text: "small" }] }
    expect(capResultContent(result, { thresholdBytes: 100 })).toBe(result)
  })

  it("handles an empty content array", () => {
    const result = { content: [] }
    expect(capResultContent(result)).toBe(result)
  })
})
