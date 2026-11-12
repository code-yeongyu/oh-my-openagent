import type { Cell } from "../vocabulary.ts"

interface FixtureElement {
  readonly role: string
  readonly title: string
}

export interface FixtureTarget {
  readonly app: string
  readonly title: string
  readonly element: FixtureElement
  readonly dragTo?: FixtureElement
  readonly menuPath?: readonly string[]
}

const TEXT = JSON.stringify("conformance")
const CHORD = JSON.stringify("ctrl+k")
const SCROLL_DY = 120

const lookup = (name: string, element: FixtureElement): string[] => [
  `const ${name} = (await win.find({ role: ${JSON.stringify(element.role)}, title: ${JSON.stringify(element.title)}, limit: 1 }))[0]`,
  `if (${name} === undefined) return { kind: "error", message: ${JSON.stringify(`fixture element ${element.role} "${element.title}" not found`)} }`,
]

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

/** `run` code for one cell. It returns its own outcome, so a refusal is read from the engine's error code. */
export function cellCode(cell: Cell, target: FixtureTarget): string {
  const body = [
    `const win = await desktop.window({ app: ${JSON.stringify(target.app)}, title: ${JSON.stringify(target.title)} })`,
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
