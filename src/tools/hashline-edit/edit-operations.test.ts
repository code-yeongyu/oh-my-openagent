import { describe, expect, it } from "bun:test"
import {
  applyHashlineEdits,
  applyInsertAfter,
  applyReplace,
  applyReplaceLines,
  applySetLine,
} from "./edit-operations"
import { computeLineHash } from "./hash-computation"
import type { HashlineEdit, InsertAfter, Replace, ReplaceLines, SetLine } from "./types"

describe("applySetLine", () => {
  function anchorFor(lines: string[], line: number): string {
    return `${line}:${computeLineHash(line, lines[line - 1])}`
  }

  it("replaces a single line at the specified anchor", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const anchor = anchorFor(lines, 2)

    //#when
    const result = applySetLine(lines, anchor, "new line 2")

    //#then
    expect(result).toEqual(["line 1", "new line 2", "line 3"])
  })

  it("handles newline escapes in replacement text", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const anchor = anchorFor(lines, 2)

    //#when
    const result = applySetLine(lines, anchor, "new\\nline")

    //#then
    expect(result).toEqual(["line 1", "new\nline", "line 3"])
  })

  it("throws on hash mismatch", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const anchor = "2:ff" // wrong hash

    //#when / #then
    expect(() => applySetLine(lines, anchor, "new")).toThrow("Hash mismatch")
  })

  it("throws on out of bounds line", () => {
    //#given
    const lines = ["line 1", "line 2"]
    const anchor = "5:00"

    //#when / #then
    expect(() => applySetLine(lines, anchor, "new")).toThrow("out of bounds")
  })
})

describe("applyReplaceLines", () => {
  it("replaces a range of lines", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3", "line 4", "line 5"]
    const startAnchor = `${2}:${computeLineHash(2, lines[1])}`
    const endAnchor = `${4}:${computeLineHash(4, lines[3])}`

    //#when
    const result = applyReplaceLines(lines, startAnchor, endAnchor, "replacement")

    //#then
    expect(result).toEqual(["line 1", "replacement", "line 5"])
  })

  it("handles newline escapes in replacement text", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const startAnchor = `${2}:${computeLineHash(2, lines[1])}`
    const endAnchor = `${2}:${computeLineHash(2, lines[1])}`

    //#when
    const result = applyReplaceLines(lines, startAnchor, endAnchor, "a\\nb")

    //#then
    expect(result).toEqual(["line 1", "a", "b", "line 3"])
  })

  it("throws on start hash mismatch", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const startAnchor = "2:ff"
    const endAnchor = `${3}:${computeLineHash(3, lines[2])}`

    //#when / #then
    expect(() => applyReplaceLines(lines, startAnchor, endAnchor, "new")).toThrow(
      "Hash mismatch"
    )
  })

  it("throws on end hash mismatch", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const startAnchor = `${2}:${computeLineHash(2, lines[1])}`
    const endAnchor = "3:ff"

    //#when / #then
    expect(() => applyReplaceLines(lines, startAnchor, endAnchor, "new")).toThrow(
      "Hash mismatch"
    )
  })

  it("throws when start > end", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const startAnchor = `${3}:${computeLineHash(3, lines[2])}`
    const endAnchor = `${2}:${computeLineHash(2, lines[1])}`

    //#when / #then
    expect(() => applyReplaceLines(lines, startAnchor, endAnchor, "new")).toThrow(
      "start line 3 cannot be greater than end line 2"
    )
  })
})

describe("applyInsertAfter", () => {
  it("inserts text after the specified line", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const anchor = `${2}:${computeLineHash(2, lines[1])}`

    //#when
    const result = applyInsertAfter(lines, anchor, "inserted")

    //#then
    expect(result).toEqual(["line 1", "line 2", "inserted", "line 3"])
  })

  it("handles newline escapes to insert multiple lines", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]
    const anchor = `${2}:${computeLineHash(2, lines[1])}`

    //#when
    const result = applyInsertAfter(lines, anchor, "a\\nb\\nc")

    //#then
    expect(result).toEqual(["line 1", "line 2", "a", "b", "c", "line 3"])
  })

  it("inserts at end when anchor is last line", () => {
    //#given
    const lines = ["line 1", "line 2"]
    const anchor = `${2}:${computeLineHash(2, lines[1])}`

    //#when
    const result = applyInsertAfter(lines, anchor, "inserted")

    //#then
    expect(result).toEqual(["line 1", "line 2", "inserted"])
  })

  it("throws on hash mismatch", () => {
    //#given
    const lines = ["line 1", "line 2"]
    const anchor = "2:ff"

    //#when / #then
    expect(() => applyInsertAfter(lines, anchor, "new")).toThrow("Hash mismatch")
  })
})

describe("applyReplace", () => {
  it("replaces exact text match", () => {
    //#given
    const content = "hello world foo bar"
    const oldText = "world"
    const newText = "universe"

    //#when
    const result = applyReplace(content, oldText, newText)

    //#then
    expect(result).toEqual("hello universe foo bar")
  })

  it("replaces all occurrences", () => {
    //#given
    const content = "foo bar foo baz foo"
    const oldText = "foo"
    const newText = "qux"

    //#when
    const result = applyReplace(content, oldText, newText)

    //#then
    expect(result).toEqual("qux bar qux baz qux")
  })

  it("handles newline escapes in newText", () => {
    //#given
    const content = "hello world"
    const oldText = "world"
    const newText = "new\\nline"

    //#when
    const result = applyReplace(content, oldText, newText)

    //#then
    expect(result).toEqual("hello new\nline")
  })

  it("throws when oldText not found", () => {
    //#given
    const content = "hello world"
    const oldText = "notfound"
    const newText = "replacement"

    //#when / #then
    expect(() => applyReplace(content, oldText, newText)).toThrow("Text not found")
  })
})

describe("applyHashlineEdits", () => {
  it("applies single set_line edit", () => {
    //#given
    const content = "line 1\nline 2\nline 3"
    const line2Hash = computeLineHash(2, "line 2")
    const edits: SetLine[] = [{ type: "set_line", line: `2:${line2Hash}`, text: "new line 2" }]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\nnew line 2\nline 3")
  })

  it("applies multiple edits bottom-up (descending line order)", () => {
    //#given
    const content = "line 1\nline 2\nline 3\nline 4\nline 5"
    const line2Hash = computeLineHash(2, "line 2")
    const line4Hash = computeLineHash(4, "line 4")
    const edits: SetLine[] = [
      { type: "set_line", line: `2:${line2Hash}`, text: "new 2" },
      { type: "set_line", line: `4:${line4Hash}`, text: "new 4" },
    ]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\nnew 2\nline 3\nnew 4\nline 5")
  })

  it("applies mixed edit types", () => {
    //#given
    const content = "line 1\nline 2\nline 3"
    const line1Hash = computeLineHash(1, "line 1")
    const line3Hash = computeLineHash(3, "line 3")
    const edits: HashlineEdit[] = [
      { type: "insert_after", line: `1:${line1Hash}`, text: "inserted" },
      { type: "set_line", line: `3:${line3Hash}`, text: "modified" },
    ]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\ninserted\nline 2\nmodified")
  })

  it("applies replace_lines edit", () => {
    //#given
    const content = "line 1\nline 2\nline 3\nline 4"
    const line2Hash = computeLineHash(2, "line 2")
    const line3Hash = computeLineHash(3, "line 3")
    const edits: ReplaceLines[] = [
      { type: "replace_lines", start_line: `2:${line2Hash}`, end_line: `3:${line3Hash}`, text: "replaced" },
    ]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\nreplaced\nline 4")
  })

  it("applies replace fallback edit", () => {
    //#given
    const content = "hello world foo"
    const edits: Replace[] = [{ type: "replace", old_text: "world", new_text: "universe" }]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("hello universe foo")
  })

  it("handles empty edits array", () => {
    //#given
    const content = "line 1\nline 2"
    const edits: HashlineEdit[] = []

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\nline 2")
  })

  it("throws on hash mismatch with descriptive error", () => {
    //#given
    const content = "line 1\nline 2\nline 3"
    const edits: SetLine[] = [{ type: "set_line", line: "2:ff", text: "new" }]

    //#when / #then
    expect(() => applyHashlineEdits(content, edits)).toThrow("Hash mismatch")
  })

  it("correctly handles index shifting with multiple edits", () => {
    //#given
    const content = "a\nb\nc\nd\ne"
    const line2Hash = computeLineHash(2, "b")
    const line4Hash = computeLineHash(4, "d")
    const edits: InsertAfter[] = [
      { type: "insert_after", line: `2:${line2Hash}`, text: "x" },
      { type: "insert_after", line: `4:${line4Hash}`, text: "y" },
    ]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("a\nb\nx\nc\nd\ny\ne")
  })
})
