import { z } from "zod"
import type { FixtureGeometry } from "./fixture-report.ts"

type Rect = FixtureGeometry["window"]["client"]

/** Widgets a pixel driver aims at, by accessible name with the role it must carry. */
const REQUIRED_WIDGETS: Readonly<Record<string, string>> = {
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
/** Smaller than this a driver cannot aim inside the rect; a widget not laid out yet reports 1x1 on GTK. */
const MIN_AIM_SIZE = 4

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/** List items must stand in the report's `dragOrder`, top to bottom without overlap: rects from before a reorder fail. */
function listOrderProblems(widgets: FixtureGeometry["widgets"], dragOrder: string): string[] {
  const rows = dragOrder.split(",").flatMap((name) => {
    const widget = widgets[name]
    return widget?.role === "list item" ? [{ name, rect: widget.rect }] : []
  })
  return rows.slice(1).flatMap((row, index) => {
    const above = rows[index]
    if (above === undefined || above.rect.y + above.rect.height <= row.rect.y) return []
    return [`list item ${row.name} is not below ${above.name}, but dragOrder is ${dragOrder}`]
  })
}

/** Every problem with a report's geometry; empty when a driver can aim at every required widget. */
export function geometryProblems(shape: FixtureGeometry | undefined, dragOrder: string): string[] {
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
    if (rect.width < MIN_AIM_SIZE || rect.height < MIN_AIM_SIZE)
      problems.push(`${name} is ${rect.width}x${rect.height}, too small to aim at (not laid out yet?)`)
    if (name !== "Test" && !inside(rect, client)) problems.push(`${name} lies outside the window's client rect`)
    if (hit !== undefined && !inside(hit, rect)) problems.push(`${name} has a hit rect outside its rect`)
    if (role === "text" && rect.width < MIN_TEXT_FIELD_WIDTH)
      problems.push(`${name} is ${rect.width} wide, too narrow for the field (a caption's rect?)`)
  }
  return [...problems, ...listOrderProblems(shape.widgets, dragOrder)]
}

/** The report text without geometry, for comparing two runs whose windows may land at different places. */
export function withoutGeometry(reportText: string): string {
  const { geometry: _geometry, ...rest } = z.record(z.string(), z.unknown()).parse(JSON.parse(reportText))
  return JSON.stringify(rest)
}
