import { describe, expect, it } from "bun:test"
import { normalizeHashlineEdits, type RawHashlineEdit } from "./normalize-edits"

describe("normalizeHashlineEdits", () => {
  it("maps replace with pos to replace", () => {
    //#given
    const input: RawHashlineEdit[] = [{ op: "replace", pos: "2#VK", lines: "updated" }]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([{ op: "replace", pos: "2#VK", lines: "updated" }])
  })

  it("maps replace with pos and end to replace", () => {
    //#given
    const input: RawHashlineEdit[] = [{ op: "replace", pos: "2#VK", end: "4#MB", lines: ["a", "b"] }]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([{ op: "replace", pos: "2#VK", end: "4#MB", lines: ["a", "b"] }])
  })

  it("maps anchored append and prepend preserving op", () => {
    //#given
    const input: RawHashlineEdit[] = [
      { op: "append", pos: "2#VK", lines: ["after"] },
      { op: "prepend", pos: "4#MB", lines: ["before"] },
    ]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([{ op: "append", pos: "2#VK", lines: ["after"] }, { op: "prepend", pos: "4#MB", lines: ["before"] }])
  })

  it("prefers pos over end for prepend anchors", () => {
    //#given
    const input: RawHashlineEdit[] = [{ op: "prepend", pos: "3#AA", end: "7#BB", lines: ["before"] }]

    //#when
    const result = normalizeHashlineEdits(input)

    //#then
    expect(result).toEqual([{ op: "prepend", pos: "3#AA", lines: ["before"] }])
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
