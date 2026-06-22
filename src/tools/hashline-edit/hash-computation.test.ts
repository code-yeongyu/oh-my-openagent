import { describe, expect, it } from "bun:test"
import { computeLineHash, formatHashLine, formatHashLines } from "./hash-computation"

const NIBBLE_CHARS = "ZPMQVRWSNKTXJBYH"
const HASH_ID_PATTERN = new RegExp(`^[${NIBBLE_CHARS}]{2}$`)

describe("computeLineHash", () => {
  it("returns consistent 2-char NIBBLE ID for same input", () => {
    //#given
    const lineNumber = 1
    const content = "function hello() {"

    //#when
    const hash1 = computeLineHash(lineNumber, content)
    const hash2 = computeLineHash(lineNumber, content)

    //#then
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(HASH_ID_PATTERN)
  })

  it("trims trailing whitespace before hashing (not all whitespace)", () => {
    //#given
    const lineNumber = 1
    const content1 = "function hello() {"
    const content2 = "function hello() {   "

    //#when
    const hash1 = computeLineHash(lineNumber, content1)
    const hash2 = computeLineHash(lineNumber, content2)

    //#then
    expect(hash1).toBe(hash2)
  })

  it("leading whitespace is significant (different hashes)", () => {
    //#given
    const lineNumber = 1
    const content1 = "function hello() {"
    const content2 = "  function hello() {"

    //#when
    const hash1 = computeLineHash(lineNumber, content1)
    const hash2 = computeLineHash(lineNumber, content2)

    //#then
    expect(hash1).not.toBe(hash2)
  })

  it("handles empty lines", () => {
    //#given
    const lineNumber = 1
    const content = ""

    //#when
    const hash = computeLineHash(lineNumber, content)

    //#then
    expect(hash).toMatch(HASH_ID_PATTERN)
  })

  it("returns different hashes for different content", () => {
    //#given
    const lineNumber = 1
    const content1 = "function hello() {"
    const content2 = "function world() {"

    //#when
    const hash1 = computeLineHash(lineNumber, content1)
    const hash2 = computeLineHash(lineNumber, content2)

    //#then
    expect(hash1).not.toBe(hash2)
  })

  it("uses NIBBLE_STR charset for blank lines", () => {
    //#given
    const content = ""

    //#when
    const hash = computeLineHash(1, content)

    //#then — hash uses NIBBLE_STR (ZPMQVRWSNKTXJBYH), must be 2 chars from that set
    expect(hash).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/)
  })
})

describe("formatHashLine", () => {
  it("formats line with LINE#ID|content format", () => {
    //#given
    const lineNumber = 42
    const content = "function hello() {"

    //#when
    const result = formatHashLine(lineNumber, content)

    //#then
    expect(result).toMatch(new RegExp(`^42#[${NIBBLE_CHARS}]{2}\\|function hello\\(\\) \\{$`))
  })

  it("uses # separator not : separator", () => {
    //#given
    const lineNumber = 1
    const content = "const x = 42"

    //#when
    const result = formatHashLine(lineNumber, content)

    //#then
    expect(result).toContain("#")
    expect(result).not.toMatch(/^\d+:/)
    expect(result).toContain("|const x = 42")
  })
})

describe("formatHashLines", () => {
  it("formats all lines with LINE#ID| prefixes", () => {
    //#given
    const content = "function hello() {\n  return 42\n}"

    //#when
    const result = formatHashLines(content)

    //#then
    const lines = result.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(new RegExp(`^1#[${NIBBLE_CHARS}]{2}\\|`))
    expect(lines[1]).toMatch(new RegExp(`^2#[${NIBBLE_CHARS}]{2}\\|`))
    expect(lines[2]).toMatch(new RegExp(`^3#[${NIBBLE_CHARS}]{2}\\|`))
  })

  it("handles empty file", () => {
    //#given
    const content = ""

    //#when
    const result = formatHashLines(content)

    //#then
    expect(result).toBe("")
  })

  it("handles single line", () => {
    //#given
    const content = "const x = 42"

    //#when
    const result = formatHashLines(content)

    //#then
    expect(result).toMatch(new RegExp(`^1#[${NIBBLE_CHARS}]{2}\\|const x = 42$`))
  })
})
