import { describe, expect, it } from "bun:test"
import { boundDetail, describeMergeConflict, formatPathList } from "./merge-conflict-detail"

describe("reflection failure details stay bounded (#12076)", () => {
  it("#given git printed a huge stderr #when bounded #then 500 characters are kept and the cut is marked", () => {
    const detail = boundDetail(`  ${"x".repeat(2_000)}\n`)
    expect(detail).toBe(`${"x".repeat(500)}...`)
  })

  it("#given short stderr with surrounding whitespace #when bounded #then it is only trimmed", () => {
    expect(boundDetail("  fatal: nope\n")).toBe("fatal: nope")
  })

  it("#given more than ten paths #when listed #then ten are named and the rest counted", () => {
    const paths = Array.from({ length: 12 }, (_, index) => `notes/${index}.md`)
    expect(formatPathList(paths)).toBe(`${paths.slice(0, 10).join(", ")} (+2 more)`)
  })

  it("#given one very long path #when listed #then the list is capped too", () => {
    expect(formatPathList([`notes/${"p".repeat(1_000)}.md`])).toHaveLength(503)
  })

  it("#given no unmerged paths and no CONFLICT lines #when described #then stderr is bounded", () => {
    expect(describeMergeConflict([], "", "e".repeat(800))).toBe(`${"e".repeat(500)}...`)
  })
})
