import { describe, expect, it } from "bun:test"
import { combineAppends } from "./append-conflict-resolution"

// #12076 review: an append is joined only at a line boundary and only from whole added lines; a change to an
// unterminated last line used to splice ("status: draft-final" + "ed").
describe("combineAppends", () => {
  it.each([
    ["base without a trailing newline, both sides extend the last line", "status: draft", "status: draft-final", "status: drafted", null],
    ["base without a trailing newline, both sides append whole lines", "a", "a\nP\n", "a\nR\n", null],
    ["base without a trailing newline, one side unchanged", "a", "a", "a\nR\n", null],
    ["base ending with a newline, both sides append", "a\n", "a\nP\n", "a\nR\n", "a\nP\nR\n"],
    ["base ending with a newline, several lines each", "a\n", "a\nP1\nP2\n", "a\nR1\nR2\n", "a\nP1\nP2\nR1\nR2\n"],
    ["identical append on both sides", "a\n", "a\nX\n", "a\nX\n", "a\nX\n"],
    ["parent side unchanged", "a\n", "a\n", "a\nR\n", "a\nR\n"],
    ["run side unchanged", "a\n", "a\nP\n", "a\n", "a\nP\n"],
    ["CRLF base, both sides append CRLF lines", "a\r\n", "a\r\nP\r\n", "a\r\nR\r\n", "a\r\nP\r\nR\r\n"],
    ["CRLF base, an added line without its newline", "a\r\n", "a\r\nP\r\n", "a\r\nR", null],
    ["empty base, both sides add whole lines", "", "P\n", "R\n", "P\nR\n"],
    ["empty base, an added line without its newline", "", "P", "R\n", null],
    ["run suffix without a trailing newline", "a\n", "a\nP\n", "a\nR", null],
    ["parent edited a base line", "a\nb\n", "a\nB\nP\n", "a\nb\nR\n", null],
    ["run edited a base line", "a\nb\n", "a\nb\nP\n", "A\nb\nR\n", null],
  ] as const)("#given %s #when combined #then the result is exact", (_case, base, parent, run, expected) => {
    expect(combineAppends(base, parent, run)).toBe(expected)
  })
})
