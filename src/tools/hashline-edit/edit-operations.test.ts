import { describe, expect, it } from "bun:test"
import { applyHashlineEdits, applyInsertAfter, applyReplaceLines, applySetLine } from "./edit-operations"
import { applyAppend, applyInsertBetween, applyPrepend } from "./edit-operation-primitives"
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

  it("applies insert_before with LINE#ID anchor", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]

    //#when
    const result = applyHashlineEdits(
      lines.join("\n"),
      [{ op: "prepend", pos: anchorFor(lines, 2), lines: "before 2" }]
    )

    //#then
    expect(result).toEqual("line 1\nbefore 2\nline 2\nline 3")
  })

  it("applies insert_between with dual anchors", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]

    //#when
    const result = applyInsertBetween(lines, anchorFor(lines, 1), anchorFor(lines, 2), ["between"]).join("\n")

    //#then
    expect(result).toEqual("line 1\nbetween\nline 2\nline 3")
  })

  it("throws when insert_after receives empty text array", () => {
    //#given
    const lines = ["line 1", "line 2"]

    //#when / #then
    expect(() => applyInsertAfter(lines, anchorFor(lines, 1), [])).toThrow(/non-empty/i)
  })

  it("throws when insert_before receives empty text array", () => {
    //#given
    const lines = ["line 1", "line 2"]

    //#when / #then
    expect(() =>
      applyHashlineEdits(lines.join("\n"), [{ op: "prepend", pos: anchorFor(lines, 1), lines: [] }])
    ).toThrow(/non-empty/i)
  })

  it("throws when insert_between receives empty text array", () => {
    //#given
    const lines = ["line 1", "line 2"]

    //#when / #then
    expect(() => applyInsertBetween(lines, anchorFor(lines, 1), anchorFor(lines, 2), [])).toThrow(/non-empty/i)
  })

  it("applies mixed edits in one pass", () => {
    //#given
    const content = "line 1\nline 2\nline 3"
    const lines = content.split("\n")
    const edits: HashlineEdit[] = [
      { op: "append", pos: anchorFor(lines, 1), lines: "inserted" },
      { op: "replace", pos: anchorFor(lines, 3), lines: "modified" },
    ]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\ninserted\nline 2\nmodified")
  })

  it("deduplicates identical insert edits in one pass", () => {
    //#given
    const content = "line 1\nline 2"
    const lines = content.split("\n")
    const edits: HashlineEdit[] = [
      { op: "append", pos: anchorFor(lines, 1), lines: "inserted" },
      { op: "append", pos: anchorFor(lines, 1), lines: "inserted" },
    ]

    //#when
    const result = applyHashlineEdits(content, edits)

    //#then
    expect(result).toEqual("line 1\ninserted\nline 2")
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
    const result = applySetLine(lines, anchorFor(lines, 2), "1#VK|first\n2#NP|second")

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

  it("throws when insert_after payload only repeats anchor line", () => {
    //#given
    const lines = ["line 1", "line 2"]

    //#when / #then
    expect(() => applyInsertAfter(lines, anchorFor(lines, 1), ["line 1"])).toThrow(/non-empty/i)
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

  it("throws when insert_between payload contains only boundary echoes", () => {
    //#given
    const lines = ["line 1", "line 2", "line 3"]

    //#when / #then
    expect(() => applyInsertBetween(lines, anchorFor(lines, 1), anchorFor(lines, 2), ["line 1", "line 2"])).toThrow(
      /non-empty/i
    )
  })

  it("restores indentation for first replace_lines entry", () => {
    //#given
    const lines = ["if (x) {", "  return 1", "  return 2", "}"]

    //#when
    const result = applyReplaceLines(lines, anchorFor(lines, 2), anchorFor(lines, 3), ["return 3", "return 4"])

    //#then
    expect(result).toEqual(["if (x) {", "  return 3", "  return 4", "}"])
  })

  it("collapses wrapped replacement span back to unique original single line", () => {
    //#given
    const lines = [
      "const request = buildRequest({ method: \"GET\", retries: 3 })",
      "const done = true",
    ]

    //#when
    const result = applyReplaceLines(
      lines,
      anchorFor(lines, 1),
      anchorFor(lines, 1),
      ["const request = buildRequest({", "method: \"GET\", retries: 3 })"]
    )

    //#then
    expect(result).toEqual([
      "const request = buildRequest({ method: \"GET\", retries: 3 })",
      "const done = true",
    ])
  })

  it("keeps wrapped replacement when canonical match is not unique in original lines", () => {
    //#given
    const lines = ["const query = a + b", "const query = a+b", "const done = true"]

    //#when
    const result = applyReplaceLines(lines, anchorFor(lines, 1), anchorFor(lines, 2), ["const query = a +", "b"])

    //#then
    expect(result).toEqual(["const query = a +", "b", "const done = true"])
  })

  it("keeps wrapped replacement when same canonical candidate appears multiple times", () => {
    //#given
    const lines = ["const expression = alpha + beta + gamma", "const done = true"]

    //#when
    const result = applyReplaceLines(lines, anchorFor(lines, 1), anchorFor(lines, 1), [
      "const expression = alpha +",
      "beta + gamma",
      "const expression = alpha +",
      "beta + gamma",
    ])

    //#then
    expect(result).toEqual([
      "const expression = alpha +",
      "beta + gamma",
      "const expression = alpha +",
      "beta + gamma",
      "const done = true",
    ])
  })

  it("keeps wrapped replacement when canonical match is shorter than threshold", () => {
    //#given
    const lines = ["a + b", "const done = true"]

    //#when
    const result = applyReplaceLines(lines, anchorFor(lines, 1), anchorFor(lines, 1), ["a +", "b"])

    //#then
    expect(result).toEqual(["a +", "b", "const done = true"])
  })

  it("applies append and prepend operations", () => {
    //#given
    const content = "line 1\nline 2"

    //#when
    const result = applyHashlineEdits(content, [
      { op: "append", lines: ["line 3"] },
      { op: "prepend", lines: ["line 0"] },
    ])

    //#then
    expect(result).toEqual("line 0\nline 1\nline 2\nline 3")
  })

  it("appends to empty file without extra blank line", () => {
    //#given
    const lines = [""]

    //#when
    const result = applyAppend(lines, ["line1"])

    //#then
    expect(result).toEqual(["line1"])
  })

  it("prepends to empty file without extra blank line", () => {
    //#given
    const lines = [""]

    //#when
    const result = applyPrepend(lines, ["line1"])

    //#then
    expect(result).toEqual(["line1"])
  })

  it("autocorrects single-line merged replacement into original line count", () => {
    //#given
    const lines = ["const a = 1;", "const b = 2;"]

    //#when
    const result = applyReplaceLines(
      lines,
      anchorFor(lines, 1),
      anchorFor(lines, 2),
      "const a = 10; const b = 20;"
    )

    //#then
    expect(result).toEqual(["const a = 10;", "const b = 20;"])
  })
})
