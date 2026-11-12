import type { Cell } from "../vocabulary.ts"

interface FixtureElement {
  readonly role?: string
  readonly title: string
}

export interface FixtureTarget {
  readonly title: string
  readonly element: FixtureElement
  readonly dragTo?: FixtureElement
  readonly menuPath?: readonly string[]
}

const TEXT = JSON.stringify("conformance")
const CHORD = JSON.stringify("ctrl+k")
const SCROLL_DY = 120

const lookup = (name: string, element: FixtureElement): string[] => {
  const query =
    element.role === undefined
      ? { title: element.title, limit: 1 }
      : { role: element.role, title: element.title, limit: 1 }
  const missing = `fixture element "${element.title}" not found`
  return [
    `const ${name} = (await win.find(${JSON.stringify(query)}))[0]`,
    `if (${name} === undefined) {`,
    `  const seen = (await win.find({ limit: 40 })).map((entry) => \`${"${entry.role}"}:${'${entry.title ?? ""}'}\`)`,
    `  return { kind: "error", message: ${JSON.stringify(missing + "; the window exposes ")} + JSON.stringify(seen) }`,
    "}",
  ]
}

// The shipped pointer verbs take pixels of the window's latest capture, so an element's bounds (global logical
// points) are mapped into that frame.
const CENTRE = [
  "const centre = async (element) => {",
  "  const box = await element.bounds()",
  '  if (box === null) throw new Error("fixture element has no bounds")',
  "  const shot = await win.screenshot()",
  "  return [",
  "    Math.round(((box.x + box.width / 2 - win.bounds.x) * shot.coordinateWidth) / win.bounds.width),",
  "    Math.round(((box.y + box.height / 2 - win.bounds.y) * shot.coordinateHeight) / win.bounds.height),",
  "  ]",
  "}",
]

function actionLines(cell: Cell, target: FixtureTarget): string[] {
  const opts = cell.mode === "foreground" ? `{ delivery: "foreground" }` : "undefined"
  const pointAt = ["const [x, y] = await centre(el)"]
  switch (cell.action) {
    case "click":
      return cell.targeting === "px" ? [...pointAt, `await win.click(x, y, ${opts})`] : [`await el.click(${opts})`]
    case "typeText":
      return cell.targeting === "px"
        ? [...pointAt, `await win.click(x, y, ${opts})`, `await win.type(${TEXT}, ${opts})`]
        : [`await el.type(${TEXT}, ${opts})`]
    case "scroll":
      // The shipped facade scrolls only at a point; the accessibility cell takes its point from the element.
      return [...pointAt, `await win.scroll(x, y, { dy: ${SCROLL_DY}, ...(${opts} ?? {}) })`]
    case "drag":
      return target.dragTo === undefined
        ? ['return { kind: "error", message: "fixture names no drop target" }']
        : [...lookup("to", target.dragTo), `await win.drag([await centre(el), await centre(to)], ${opts})`]
    case "keyChord":
      return ["await el.focus()", `await win.press(${CHORD}, ${opts})`]
    case "ax.setValue":
      return [`await el.setValue(${TEXT})`]
    case "ax.perform":
      return ["await el.press()"]
    case "menu.select":
      return target.menuPath === undefined
        ? ['return { kind: "error", message: "fixture names no menu path" }']
        : [`await win.menu.select(${JSON.stringify(target.menuPath)}, ${opts})`]
  }
}

// The shipped runtime matches `app` against the engine's own app name for the window (not the fixture's display
// name), so the window is found by its exact title; a miss records the windows the engine listed, as evidence.
function windowLookup(target: FixtureTarget): string[] {
  const title = JSON.stringify(target.title)
  return [
    `const listed = await desktop.windows({ title: ${title} })`,
    `const record = listed.find((entry) => entry.title === ${title})`,
    "if (record === undefined) {",
    `  const seen = (await desktop.windows()).slice(0, 12).map((entry) => ({ app: entry.app, title: entry.title, pid: entry.pid }))`,
    `  return { kind: "error", message: \`no window titled ${target.title.replaceAll("`", "")}; engine lists \${JSON.stringify(seen)}\` }`,
    "}",
    "const win = await desktop.window(record.id)",
  ]
}

/** `run` code for one cell. It returns its own outcome, so a refusal is read from the engine's error code. */
export function cellCode(cell: Cell, target: FixtureTarget): string {
  const body = [
    ...windowLookup(target),
    ...lookup("el", target.element),
    ...CENTRE,
    ...actionLines(cell, target),
    'return { kind: "delivered" }',
  ]
  return [
    "try {",
    ...body.map((line) => `  ${line}`),
    "} catch (error) {",
    "  const code = error?.data?.code",
    '  if (typeof code === "string") return { kind: "refused", code }',
    '  return { kind: "error", message: String(error?.message ?? error) }',
    "}",
  ].join("\n")
}
