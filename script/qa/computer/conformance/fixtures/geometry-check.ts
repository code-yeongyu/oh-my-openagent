import { z } from "zod"
import type { FixtureGeometry } from "./fixture-report.ts"

type Rect = FixtureGeometry["window"]["client"]

/** Widgets a pixel driver aims at, by accessible name with the role it must carry. */
export const REQUIRED_WIDGETS: Readonly<Record<string, string>> = {
  Press: "button",
  Value: "text",
  Title: "text",
  Name: "text",
  Email: "text",
  City: "text",
  Note: "text",
  "New item": "text",
  Archived: "checkbox",
  Add: "button",
  "Mark done": "button",
  "Scroll target": "region",
  a: "list item",
  b: "list item",
  Test: "menubar item",
}

const MIN_TEXT_FIELD_WIDTH = 100

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/** Every problem with a report's geometry; empty when a driver can aim at every required widget. */
export function geometryProblems(shape: FixtureGeometry | undefined): string[] {
  if (shape === undefined) return ["the report carries no geometry"]
  const problems: string[] = []
  const { client, frame } = shape.window
  if (!inside(client, frame)) problems.push("the window's client rect is not inside its frame rect")
  for (const [name, role] of Object.entries(REQUIRED_WIDGETS)) {
    const widget = shape.widgets[name]
    if (widget === undefined) {
      problems.push(`no rect for ${name}`)
      continue
    }
    const { rect, hit } = widget
    if (widget.role !== role) problems.push(`${name} has role ${widget.role}, expected ${role}`)
    if (rect.width <= 0 || rect.height <= 0) problems.push(`${name} has an empty rect`)
    if (name !== "Test" && !inside(rect, client)) problems.push(`${name} lies outside the window's client rect`)
    if (hit !== undefined && !inside(hit, rect)) problems.push(`${name} has a hit rect outside its rect`)
    if (role === "text" && rect.width < MIN_TEXT_FIELD_WIDTH)
      problems.push(`${name} is ${rect.width} wide, too narrow for the field (a caption's rect?)`)
  }
  return problems
}

/** The report text without geometry, for comparing two runs whose windows may land at different places. */
export function withoutGeometry(reportText: string): string {
  const { geometry: _geometry, ...rest } = z.record(z.string(), z.unknown()).parse(JSON.parse(reportText))
  return JSON.stringify(rest)
}
