import { describe, expect, it } from "bun:test"
import { normalizeHashlineEdits, type RawHashlineEdit } from "./normalize-edits"

describe("normalizeHashlineEdits", () => {
  it("maps replace with pos to set_line", () => {
    //#given
    const input: RawHashlineEdit[] = [{ op: "replace", pos: "2#VK", lines: "updated" }]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([{ type: "set_line", line: "2#VK", text: "updated" }])
  })

  it("maps replace with pos and end to replace_lines", () => {
    //#given
    const input: RawHashlineEdit[] = [{ op: "replace", pos: "2#VK", end: "4#MB", lines: ["a", "b"] }]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([{ type: "replace_lines", start_line: "2#VK", end_line: "4#MB", text: ["a", "b"] }])
  })

  it("maps anchored append and prepend to insert operations", () => {
    //#given
    const input: RawHashlineEdit[] = [
      { op: "append", pos: "2#VK", lines: ["after"] },
      { op: "prepend", pos: "4#MB", lines: ["before"] },
    ]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([
      { type: "insert_after", line: "2#VK", text: ["after"] },
      { type: "insert_before", line: "4#MB", text: ["before"] },
    ])
  })

  it("prefers pos over end for prepend anchors", () => {
    //#given
    const input: RawHashlineEdit[] = [{ op: "prepend", pos: "3#AA", end: "7#BB", lines: ["before"] }]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([{ type: "insert_before", line: "3#AA", text: ["before"] }])
  })

  it("rejects legacy payload without op", () => {
    //#given
    const input = [{ type: "set_line", line: "2#VK", text: "updated" }] as unknown as Parameters<
      typeof normalizeHashlineEdits
    >[0]

    //#when / #then
    expect(() => normalizeHashlineEdits(input)).toThrow(/legacy format was removed/i)
  })
})
