import { describe, it, expect } from "bun:test"
import {
  computeLineHash,
  formatHashLine,
  formatHashLines,
  streamHashLinesFromLines,
  streamHashLinesFromUtf8,
} from "./hash-computation"

describe("computeLineHash", () => {
  it("returns deterministic 2-char CID hash per line", () => {
    //#given
    const content = "function hello() {"

    //#when
    const hash1 = computeLineHash(1, content)
    const hash2 = computeLineHash(1, content)

    //#then
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/)
  })

  it("produces same hashes for significant content on different lines", () => {
    //#given
    const content = "function hello() {"

    //#when
    const hash1 = computeLineHash(1, content)
    const hash2 = computeLineHash(2, content)

    //#then
    expect(hash1).toBe(hash2)
  })

  it("mixes line number for non-significant lines", () => {
    //#given
    const punctuationOnly = "{}"

    //#when
    const hash1 = computeLineHash(1, punctuationOnly)
    const hash2 = computeLineHash(2, punctuationOnly)

    //#then
    expect(hash1).not.toBe(hash2)
  })

  it("ignores whitespace differences", () => {
    //#given
    const content1 = "function hello() {"
    const content2 = "  function hello() {  "

    //#when
    const hash1 = computeLineHash(1, content1)
    const hash2 = computeLineHash(1, content2)

    //#then
    expect(hash1).toBe(hash2)
  })
})

describe("formatHashLine", () => {
  it("formats single line as LINE#ID|content", () => {
    //#given
    const lineNumber = 42
    const content = "const x = 42"

    //#when
    const result = formatHashLine(lineNumber, content)

    //#then
    expect(result).toMatch(/^42#[ZPMQVRWSNKTXJBYH]{2}\|const x = 42$/)
  })
})

describe("formatHashLines", () => {
  it("formats all lines as LINE#ID|content", () => {
    //#given
    const content = "a\nb\nc"

    //#when
    const result = formatHashLines(content)

    //#then
    const lines = result.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}\|a$/)
    expect(lines[1]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}\|b$/)
    expect(lines[2]).toMatch(/^3#[ZPMQVRWSNKTXJBYH]{2}\|c$/)
  })
})

describe("streamHashLinesFrom*", () => {
  async function collectStream(stream: AsyncIterable<string>): Promise<string> {
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    return chunks.join("\n")
  }

  async function* utf8Chunks(text: string, chunkSize: number): AsyncGenerator<Uint8Array> {
    const encoded = new TextEncoder().encode(text)
    for (let i = 0; i < encoded.length; i += chunkSize) {
      yield encoded.slice(i, i + chunkSize)
    }
  }

  it("matches formatHashLines for utf8 stream input", async () => {
    //#given
    const content = "a\nb\nc"

    //#when
    const result = await collectStream(streamHashLinesFromUtf8(utf8Chunks(content, 1), { maxChunkLines: 1 }))

    //#then
    expect(result).toBe(formatHashLines(content))
  })

  it("matches formatHashLines for line iterable input", async () => {
    //#given
    const content = "x\ny\n"
    const lines = ["x", "y", ""]

    //#when
    const result = await collectStream(streamHashLinesFromLines(lines, { maxChunkLines: 2 }))

    //#then
    expect(result).toBe(formatHashLines(content))
  })

  it("matches formatHashLines for empty utf8 stream input", async () => {
    //#given
    const content = ""

    //#when
    const result = await collectStream(streamHashLinesFromUtf8(utf8Chunks(content, 1), { maxChunkLines: 1 }))

    //#then
    expect(result).toBe(formatHashLines(content))
  })

  it("matches formatHashLines for empty line iterable input", async () => {
    //#given
    const content = ""

    //#when
    const result = await collectStream(streamHashLinesFromLines([], { maxChunkLines: 1 }))

    //#then
    expect(result).toBe(formatHashLines(content))
  })
})
