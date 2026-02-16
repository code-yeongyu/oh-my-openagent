import { describe, it, expect } from "bun:test"
import { computeLineHash, formatHashLine, formatHashLines } from "./hash-computation"

describe("computeLineHash", () => {
  it("returns consistent 2-char hex for same input", () => {
    //#given
    const lineNumber = 1
    const content = "function hello() {"

    //#when
    const hash1 = computeLineHash(lineNumber, content)
    const hash2 = computeLineHash(lineNumber, content)

    //#then
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[0-9a-f]{2}$/)
  })

  it("strips whitespace before hashing", () => {
    //#given
    const lineNumber = 1
    const content1 = "function hello() {"
    const content2 = "  function hello() {  "

    //#when
    const hash1 = computeLineHash(lineNumber, content1)
    const hash2 = computeLineHash(lineNumber, content2)

    //#then
    expect(hash1).toBe(hash2)
  })

  it("handles empty lines", () => {
    //#given
    const lineNumber = 1
    const content = ""

    //#when
    const hash = computeLineHash(lineNumber, content)

    //#then
    expect(hash).toMatch(/^[0-9a-f]{2}$/)
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
})

describe("formatHashLine", () => {
  it("formats line with hash prefix", () => {
    //#given
    const lineNumber = 42
    const content = "function hello() {"

    //#when
    const result = formatHashLine(lineNumber, content)

    //#then
    expect(result).toMatch(/^42:[0-9a-f]{2}\|function hello\(\) \{$/)
  })

  it("preserves content after hash prefix", () => {
    //#given
    const lineNumber = 1
    const content = "const x = 42"

    //#when
    const result = formatHashLine(lineNumber, content)

    //#then
    expect(result).toContain("|const x = 42")
  })
})

describe("formatHashLines", () => {
  it("formats all lines with hash prefixes", () => {
    //#given
    const content = "function hello() {\n  return 42\n}"

    //#when
    const result = formatHashLines(content)

    //#then
    const lines = result.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^1:[0-9a-f]{2}\|/)
    expect(lines[1]).toMatch(/^2:[0-9a-f]{2}\|/)
    expect(lines[2]).toMatch(/^3:[0-9a-f]{2}\|/)
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
    expect(result).toMatch(/^1:[0-9a-f]{2}\|const x = 42$/)
  })
})
