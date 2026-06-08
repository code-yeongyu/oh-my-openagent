/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { parsePatch } from "diff"
import { generateUnifiedDiff } from "./diff-utils"

function createNumberedLines(totalLineCount: number): string {
  return Array.from({ length: totalLineCount }, (_, index) => `line ${index + 1}`).join("\n")
}

describe("generateUnifiedDiff", () => {
  describe("#given OpenCode compatibility format", () => {
    it("#then includes the Index header emitted by diff library", () => {
      //#given
      const oldContent = "a\n"
      const newContent = "b\n"

      //#when
      const diff = generateUnifiedDiff(oldContent, newContent, "test.ts")

      //#then
      expect(diff).toContain("Index: test.ts")
    })

    it("#then includes unified --- and +++ file headers", () => {
      //#given
      const oldContent = "a\n"
      const newContent = "b\n"

      //#when
      const diff = generateUnifiedDiff(oldContent, newContent, "test.ts")

      //#then
      expect(diff).toContain("--- test.ts")
      expect(diff).toContain("+++ test.ts")
    })

    it("#then remains parseable by OpenCode parsePatch flow", () => {
      //#given
      const oldContent = "line1\nline2\n"
      const newContent = "line1\nline2-updated\n"

      //#when
      const diff = generateUnifiedDiff(oldContent, newContent, "test.ts")
      const patches = parsePatch(diff)

      //#then
      expect(patches).toHaveLength(1)
      expect(patches[0]?.oldFileName).toBe("test.ts")
      expect(patches[0]?.newFileName).toBe("test.ts")
      expect(patches[0]?.hunks).toHaveLength(1)
    })
  })

  describe("#given content without trailing newline", () => {
    it("#then keeps no-newline markers parseable", () => {
      //#given
      const oldContent = "a"
      const newContent = "b"

      //#when
      const diff = generateUnifiedDiff(oldContent, newContent, "test.ts")
      const patches = parsePatch(diff)
      const hunkLines = patches[0]?.hunks[0]?.lines ?? []

      //#then
      expect(diff).toContain("\\ No newline at end of file")
      expect(hunkLines).toEqual(["-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file"])
    })
  })

  it("creates separate hunks for distant changes", () => {
    //#given
    const oldContent = createNumberedLines(60)
    const newLines = oldContent.split("\n")
    newLines[4] = "line 5 updated"
    newLines[49] = "line 50 updated"
    const newContent = newLines.join("\n")

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "sample.txt")

    //#then
    const hunkHeaders = diff.match(/^@@/gm) ?? []
    expect(hunkHeaders.length).toBe(2)
  })

  it("creates a single hunk for adjacent changes", () => {
    //#given
    const oldContent = createNumberedLines(20)
    const newLines = oldContent.split("\n")
    newLines[9] = "line 10 updated"
    newLines[10] = "line 11 updated"
    const newContent = newLines.join("\n")

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "sample.txt")

    //#then
    const hunkHeaders = diff.match(/^@@/gm) ?? []
    expect(hunkHeaders.length).toBe(1)
    expect(diff).toContain(" line 8")
    expect(diff).toContain(" line 13")
  })

  it("limits each hunk to three context lines", () => {
    //#given
    const oldContent = createNumberedLines(20)
    const newLines = oldContent.split("\n")
    newLines[9] = "line 10 updated"
    const newContent = newLines.join("\n")

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "sample.txt")

    //#then
    expect(diff).toContain(" line 7")
    expect(diff).toContain(" line 13")
    expect(diff).not.toContain(" line 6")
    expect(diff).not.toContain(" line 14")
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

  it("returns a valid diff when old content is empty", () => {
    //#given
    const oldContent = ""
    const newContent = "first line\nsecond line"

    //#when
    const diff = generateUnifiedDiff(oldContent, newContent, "sample.txt")

    //#then
    expect(diff).toContain("--- sample.txt")
    expect(diff).toContain("+++ sample.txt")
    expect(diff).toContain("+first line")
  })
})
