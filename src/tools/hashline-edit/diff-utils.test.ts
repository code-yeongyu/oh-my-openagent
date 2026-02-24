/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { generateUnifiedDiff } from "./diff-utils"

function createNumberedLines(totalLineCount: number): string {
  return Array.from({ length: totalLineCount }, (_, index) => `line ${index + 1}`).join("\n")
}

describe("generateUnifiedDiff", () => {
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
