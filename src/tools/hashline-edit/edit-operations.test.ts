import { describe, expect, it } from "bun:test"
import { applyHashlineEdits, applyInsertAfter, applyReplace, applyReplaceLines, applySetLine } from "./edit-operations"
import { computeLineHash } from "./hash-computation"
import type { HashlineEdit } from "./types"

function anchorFor(lines: string[], line: number): string {
  return `${line}#${computeLineHash(line, lines[line - 1])}`
}

describe("hashline edit operations", () => {
  it("applies set_line with LINE#ID anchor", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]

    //#when
    const result = applySetLine(lines, anchorFor(lines, 2), "new line 2")

    //#then
    expect(result).toEqual(["line 1", "new line 2", "line 3"])
  })

  it("applies replace_lines with LINE#ID anchors", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3", "line 4"]

    //#when
    const result = applyReplaceLines(lines, anchorFor(lines, 2), anchorFor(lines, 3), "replaced")

    //#then
    expect(result).toEqual(["line 1", "replaced", "line 4"])
  })

  it("applies insert_after with LINE#ID anchor", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]

    //#when
    const result = applyInsertAfter(lines, anchorFor(lines, 2), "inserted")

    //#then
    expect(result).toEqual(["line 1", "line 2", "inserted", "line 3"])
  })

  it("applies replace operation", () => {
    //#given
    const content = "hello world foo"

    //#when
    const result = applyReplace(content, "world", "universe")

    //#then
    expect(result).toEqual("hello universe foo")
  })

  it("applies mixed edits in one pass", () => {
    //#given
    const content = "line 1\nline 2\nline 3"
    const lines = content.split("\n")
    const edits: HashlineEdit[] = [
      { type: "insert_after", line: anchorFor(lines, 1), text: "inserted" },
      { type: "set_line", line: anchorFor(lines, 3), text: "modified" },
    ]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\ninserted\nline 2\nmodified")
  })

  it("keeps literal backslash-n in plain string text", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]

    //#when
    const result = applySetLine(lines, anchorFor(lines, 2), "join(\\n)")

    //#then
    expect(result).toEqual(["line 1", "join(\\n)", "line 3"])
  })

  it("strips copied hashline prefixes from multiline text", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]

    //#when
    const result = applySetLine(lines, anchorFor(lines, 2), "1#VK:first\n2#NP:second")

    //#then
    expect(result).toEqual(["line 1", "first", "second", "line 3"])
  })

  it("autocorrects anchor echo for insert_after payload", () => {
    //#given
    const lines = ["line 1", "line 2"]

    //#when
    const result = applyInsertAfter(lines, anchorFor(lines, 1), ["line 1", "inserted"])

    //#then
    expect(result).toEqual(["line 1", "inserted", "line 2"])
  })

  it("restores indentation for paired single-line replacement", () => {
    //#given
    const lines = ["if (x) {", "  return 1", "}"]

    //#when
    const result = applySetLine(lines, anchorFor(lines, 2), "return 2")

    //#then
    expect(result).toEqual(["if (x) {", "  return 2", "}"])
  })

  it("strips boundary echo around replace_lines content", () => {
    //#given
    const lines = ["before", "old 1", "old 2", "after"]

    //#when
    const result = applyReplaceLines(
      lines,
      anchorFor(lines, 2),
      anchorFor(lines, 3),
      ["before", "new 1", "new 2", "after"]
    )

    //#then
    expect(result).toEqual(["before", "new 1", "new 2", "after"])
  })
})
