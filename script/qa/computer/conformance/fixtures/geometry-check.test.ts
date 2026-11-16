import { describe, expect, test } from "bun:test"

import type { FixtureGeometry } from "./fixture-report.ts"
import { geometryProblems } from "./geometry-check.ts"

type Rect = FixtureGeometry["window"]["client"]
const at = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })

function shape(rows: { a: Rect; b: Rect }): FixtureGeometry {
  const widget = (role: string, rect: Rect) => ({ role, rect })
  const field = (y: number) => widget("text", at(8, y, 624, 30))
  return {
    space: "screen-logical",
    scale: 1,
    window: { client: at(0, 0, 640, 700), frame: at(-1, -30, 642, 731) },
    widgets: {
      Press: widget("button", at(8, 30, 80, 30)),
      Value: field(70),
      Title: field(110),
      Name: field(150),
      Email: field(190),
      City: field(230),
      Note: field(270),
      "New item": field(310),
      Archived: { role: "checkbox", rect: at(8, 350, 120, 24), hit: at(8, 350, 90, 24) },
      Add: widget("button", at(8, 380, 80, 30)),
      "Mark done": widget("button", at(100, 380, 100, 30)),
      "Scroll target": widget("region", at(8, 420, 624, 50)),
      a: widget("list item", rows.a),
      b: widget("list item", rows.b),
      Test: widget("menubar item", at(40, -20, 40, 20)),
    },
  }
}

const first = at(8, 475, 624, 21)
const second = at(8, 496, 624, 21)

describe("geometryProblems: the rects a pixel driver aims with", () => {
  test("a laid-out window whose list items stand in dragOrder has no problem", () => {
    expect(geometryProblems(shape({ a: first, b: second }), "a,b,c")).toEqual([])
    expect(geometryProblems(shape({ a: second, b: first }), "b,a,c")).toEqual([])
  })

  test("rows written before GTK laid them out (1x1 at the same point) are caught", () => {
    const stale = at(7, 474, 1, 1)
    const problems = geometryProblems(shape({ a: stale, b: stale }), "b,a,c")
    expect(problems).toHaveLength(3)
    expect(problems).toEqual([expect.stringMatching(/^a /), expect.stringMatching(/^b /), expect.stringMatching(/ a .* b,/)])
  })

  test("full-size rects from before the reorder do not pass for the order after it", () => {
    expect(geometryProblems(shape({ a: first, b: second }), "b,a,c")).toEqual([expect.stringMatching(/ a .* b,/)])
  })

  test("a report without geometry is one problem", () => {
    expect(geometryProblems(undefined, "a,b,c")).toEqual(["the report carries no geometry"])
  })
})
