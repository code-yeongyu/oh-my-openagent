/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { countLineDiffs, generateUnifiedDiff, toHashlineContent } from "./diff-utils"

describe("generateUnifiedDiff", () => {
  it("includes --- and +++ file headers", () => {
    //#given
    const oldContent = "a\n"
    const newContent = "b\n"

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "test.ts")

    //#then
    expect(diff).toContain("--- test.ts")
    expect(diff).toContain("+++ test.ts")
  })

  it("marks changed lines with - and + prefixes", () => {
    //#given
    const oldContent = "line1\nline2\n"
    const newContent = "line1\nline2-updated\n"

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "test.ts")

    //#then
    expect(diff).toContain("- 2#")
    expect(diff).toContain("+ 2#")
  })

  it("marks added lines with + prefix when old content is empty", () => {
    //#given
    const oldContent = ""
    const newContent = "first line\nsecond line"

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "sample.txt")

    //#then
    expect(diff).toContain("--- sample.txt")
    expect(diff).toContain("+++ sample.txt")
    expect(diff).toContain("+ 1#")
  })

  it("returns a diff string for identical content", () => {
    //#given
    const oldContent = "alpha\nbeta\ngamma"
    const newContent = "alpha\nbeta\ngamma"

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "sample.txt")

    //#then
    expect(typeof diff).toBe("string")
    expect(diff).toContain("--- sample.txt")
    expect(diff).toContain("+++ sample.txt")
  })
})

describe("countLineDiffs", () => {
  it("counts additions and deletions correctly", () => {
    //#given
    const oldContent = "a\nb\nc"
    const newContent = "a\nb\nd"

    //#when
    const result = countLineDiffs(oldContent, newContent)

    //#then
    expect(result.additions).toBe(1)
    expect(result.deletions).toBe(1)
  })

  it("returns zero for identical content", () => {
    //#given
    const content = "a\nb\nc"

    //#when
    const result = countLineDiffs(content, content)

    //#then
    expect(result.additions).toBe(0)
    expect(result.deletions).toBe(0)
  })
})

describe("toHashlineContent", () => {
  it("formats lines with LINE#ID|content format", () => {
    //#given
    const content = "hello\nworld"

    //#when
    const result = toHashlineContent(content)

    //#then
    expect(result).toMatch(/^1#[ZPMQVRWSNKTXJBYH]{2}\|hello\n2#[ZPMQVRWSNKTXJBYH]{2}\|world$/)
  })

  it("preserves trailing newline", () => {
    //#given
    const content = "hello\nworld\n"

    //#when
    const result = toHashlineContent(content)

    //#then
    expect(result.endsWith("\n")).toBe(true)
  })

  it("returns empty string for empty input", () => {
    //#given
    const content = ""

    //#when
    const result = toHashlineContent(content)

    //#then
    expect(result).toBe("")
  })
})
