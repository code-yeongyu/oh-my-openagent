import { describe, it, expect } from "bun:test"
import { computeLineHash, formatHashLine, formatHashLines } from "./hash-computation"

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

  it("produces different hashes for same content on different lines", () => {
    //#given
    const content = "function hello() {"

    //#when
    const hash1 = computeLineHash(1, content)
    const hash2 = computeLineHash(2, content)

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
  it("formats single line as LINE#ID:content", () => {
    //#given
    const lineNumber = 42
    const content = "const x = 42"

    //#when
    const result = formatHashLine(lineNumber, content)

    //#then
    expect(result).toMatch(/^42#[ZPMQVRWSNKTXJBYH]{2}:const x = 42$/)
  })
})

describe("formatHashLines", () => {
  it("formats all lines as LINE#ID:content", () => {
    //#given
    const content = "a\nb\nc"

    //#when
    const result = formatHashLines(content)

    //#then
    const lines = result.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}:a$/)
    expect(lines[1]).toMatch(/^2#[ZPMQVRWSNKTXJBYH]{2}:b$/)
    expect(lines[2]).toMatch(/^3#[ZPMQVRWSNKTXJBYH]{2}:c$/)
  })
})
