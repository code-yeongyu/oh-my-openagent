import { describe, expect, it } from "bun:test"
import {
  HASHLINE_DICT,
  HASHLINE_OUTPUT_PATTERN,
  HASHLINE_REF_PATTERN,
  NIBBLE_STR,
} from "./constants"
import { autocorrectReplacementLines } from "./autocorrect-replacement-lines"
import { collectLineRefs, detectOverlappingRanges } from "./edit-ordering"
import { toNewLines } from "./edit-text-normalization"
import { canonicalizeFileText, restoreFileText } from "./file-text-canonicalization"
import { createHashlineChunkFormatter } from "./hashline-chunk-formatter"
import { generateHashlineDiff } from "./hashline-edit-diff"

describe("smoke coverage for moved modules without direct legacy tests", () => {
  it("exposes constants and patterns", () => {
    expect(NIBBLE_STR).toHaveLength(16)
    expect(HASHLINE_DICT).toHaveLength(256)
    expect(HASHLINE_REF_PATTERN.test("1#ZZ")).toBe(true)
    expect(HASHLINE_OUTPUT_PATTERN.test("1#ZZ|line")).toBe(true)
  })

  it("runs representative helpers", () => {
    const normalized = toNewLines("1#ZZ|alpha\n2#PM|beta")
    expect(normalized).toEqual(["alpha", "beta"])

    const corrected = autocorrectReplacementLines(["  return 1"], ["return 2"])
    expect(corrected).toEqual(["  return 2"])

    const refs = collectLineRefs([{ op: "replace", pos: "1#ZZ", lines: "x" }])
    expect(refs).toEqual(["1#ZZ"])
    expect(
      detectOverlappingRanges([
        { op: "replace", pos: "1#ZZ", end: "2#PM", lines: "x" },
        { op: "replace", pos: "2#PM", end: "3#QV", lines: "y" },
      ])
    ).toContain("Overlapping range edits")

    const envelope = canonicalizeFileText("\uFEFFa\r\nb\r\n")
    expect(restoreFileText(envelope.content, envelope)).toBe("\uFEFFa\r\nb\r\n")

    const formatter = createHashlineChunkFormatter({ maxChunkLines: 1, maxChunkBytes: 1024 })
    expect(formatter.push("1#ZZ|a")).toEqual(["1#ZZ|a"])

    const diff = generateHashlineDiff("a", "b", "x.ts")
    expect(diff).toContain("+++ x.ts")
  })
})
