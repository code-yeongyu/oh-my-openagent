import { describe, expect, test } from "bun:test"

import { mergeGitDeltas, parseNumstatZ, parsePorcelainZ } from "./parse"

// Captured verbatim from a real repository holding all five states at once: an unstaged delete,
// a staged rename, an unstaged modify, a staged modify whose path contains a space, and an
// untracked file. Hand-written fixtures would have missed the field order git actually uses.
const STATUS =
  " D gone.txt\u0000R  renamed-new.txt\u0000renamed.txt\u0000 M tracked.txt\u0000M  with space.txt\u0000?? brand-new.txt\u0000"
const UNSTAGED = "0\t1\tgone.txt\u00002\t1\ttracked.txt\u0000"
const STAGED = "0\t0\t\u0000renamed.txt\u0000renamed-new.txt\u00001\t0\twith space.txt\u0000"

describe("parsePorcelainZ", () => {
  test("#given real status output #when parsed #then every state keeps its columns and path", () => {
    // given
    const output = STATUS

    // when
    const entries = parsePorcelainZ(output)

    // then
    expect(entries).toEqual([
      { xy: " D", path: "gone.txt" },
      { xy: "R ", path: "renamed-new.txt", from: "renamed.txt" },
      { xy: " M", path: "tracked.txt" },
      { xy: "M ", path: "with space.txt" },
      { xy: "??", path: "brand-new.txt" },
    ])
  })

  test("#given a rename #when parsed #then the origin path is not mistaken for another entry", () => {
    // given
    const output = STATUS

    // when
    const paths = parsePorcelainZ(output).map((entry) => entry.path)

    // then
    expect(paths).not.toContain("renamed.txt")
  })

  test("#given empty output #when parsed #then no entries are produced", () => {
    // given
    const output = ""

    // when
    const entries = parsePorcelainZ(output)

    // then
    expect(entries).toEqual([])
  })
})

describe("parseNumstatZ", () => {
  test("#given unstaged numstat #when parsed #then each path carries its line counts", () => {
    // given
    const output = UNSTAGED

    // when
    const deltas = parseNumstatZ(output)

    // then
    expect(deltas.get("gone.txt")).toEqual({ added: 0, removed: 1 })
    expect(deltas.get("tracked.txt")).toEqual({ added: 2, removed: 1 })
  })

  test("#given a staged rename #when parsed #then the counts land on the destination path", () => {
    // given
    const output = STAGED

    // when
    const deltas = parseNumstatZ(output)

    // then
    expect(deltas.get("renamed-new.txt")).toEqual({ added: 0, removed: 0 })
    expect(deltas.has("renamed.txt")).toBe(false)
  })

  test("#given a path containing a space #when parsed #then it survives intact", () => {
    // given
    const output = STAGED

    // when
    const deltas = parseNumstatZ(output)

    // then
    expect(deltas.get("with space.txt")).toEqual({ added: 1, removed: 0 })
  })

  test("#given a binary file #when parsed #then its dashes read as zero rather than NaN", () => {
    // given
    const output = "-\t-\tlogo.png\u0000"

    // when
    const deltas = parseNumstatZ(output)

    // then
    expect(deltas.get("logo.png")).toEqual({ added: 0, removed: 0 })
  })
})

describe("mergeGitDeltas", () => {
  test("#given staged and unstaged counts #when merged #then each file reports the sum", () => {
    // given
    const entries = parsePorcelainZ(STATUS)

    // when
    const merged = mergeGitDeltas(entries, parseNumstatZ(UNSTAGED), parseNumstatZ(STAGED))

    // then
    expect(merged.map((entry) => [entry.path, entry.added, entry.removed])).toEqual([
      ["gone.txt", 0, 1],
      ["renamed-new.txt", 0, 0],
      ["tracked.txt", 2, 1],
      ["with space.txt", 1, 0],
      ["brand-new.txt", undefined, undefined],
    ])
  })
})
