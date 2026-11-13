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

// Both fixtures label a field with a caption of the same name, so a lookup by name returns the caption too. A label is
// never the target; the resolved role, bounds and every candidate's role travel with the outcome as evidence.
const LABEL = "/static|label/i"

const lookup = (name: string, element: FixtureElement): string[] => {
  const query =
    element.role === undefined
      ? { title: element.title, limit: 10 }
      : { role: element.role, title: element.title, limit: 10 }
  const missing = `fixture element "${element.title}" not found`
  return [
    `const ${name}Found = await win.find(${JSON.stringify(query)})`,
    `const ${name} = ${name}Found.find((entry) => !${LABEL}.test(entry.role ?? "")) ?? ${name}Found[0]`,
    `if (${name} === undefined) {`,
    `  const seen = (await win.find({ limit: 40 })).map((entry) => \`${"${entry.role}"}:${'${entry.title ?? ""}'}\`)`,
    `  return { kind: "error", message: ${JSON.stringify(missing + "; the window exposes ")} + JSON.stringify(seen) }`,
    "}",
    `resolved.${name} = { role: ${name}.role ?? null, bounds: await Promise.resolve(${name}.bounds()).catch(() => null), candidates: ${name}Found.map((entry) => entry.role ?? null) }`,
  ]
}

const TYPING: ReadonlySet<Cell["action"]> = new Set(["typeText", "ax.setValue", "keyChord"])

// A typing cell aimed at a caption would measure the harness, not the release, so the driver refuses to send it.
function labelCheck(cell: Cell): string[] {
  if (!TYPING.has(cell.action)) return []
  return [
    `if (${LABEL}.test(el.role ?? "")) return { kind: "error", message: "the typing target resolved to a label: " + JSON.stringify(resolved.el), resolved }`,
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

// A synthetic pointer event lands on whatever is under the pointer. Each pointer cell aims at the centre of the element
// the driver resolved, and a pixel cell is decided by geometry alone: it sends only when that point is inside the
// window and inside the element's bounds. The engine's hit-test answer at the point never decides anything; it is
// recorded on the cell with whether it named the target, because a mismatch is a finding about the release.
const AIM = [
  "let aimed = null",
  "const aim = async (element) => {",
  "  const box = await element.bounds()",
  '  if (box === null) throw new Error("fixture element has no bounds")',
  "  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }",
  "  const at = await desktop.elementAt(point.x, point.y)",
  "  aimed = { point, window: win.bounds, bounds: box, role: at?.role ?? null, title: at?.title ?? null }",
  "  return aimed",
  "}",
]

const POINTER: ReadonlySet<Cell["action"]> = new Set(["click", "typeText", "scroll", "drag"])

function aimLines(cell: Cell, target: FixtureTarget): string[] {
  if (!POINTER.has(cell.action)) return []
  const title = JSON.stringify(target.element.title)
  const check = ["const seen = await aim(el)", `seen.matchesTarget = seen.title === ${title}`]
  if (cell.targeting !== "px") return check
  return [
    ...check,
    "const within = (r, p) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height",
    `if (!within(win.bounds, seen.point) || !within(seen.bounds, seen.point)) return { kind: "error", message: "aim point is outside the target's bounds or the window", aim: seen }`,
  ]
}

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
// A fixture process reports itself ready before the window server lists its window (measured on hosted macOS), so the
// lookup asks again until a bound. The release's run sandbox has no timers, so each engine call paces the loop.
function windowLookup(target: FixtureTarget, waitMs: number): string[] {
  const title = JSON.stringify(target.title)
  return [
    `const lookUp = async () => (await desktop.windows({ title: ${title} })).find((entry) => entry.title === ${title})`,
    "const waitStarted = Date.now()",
    `const waitUntil = waitStarted + ${waitMs}`,
    "let record = await lookUp()",
    "while (record === undefined && Date.now() < waitUntil) {",
    "  record = await lookUp()",
    "}",
    "resolved.windowWaitMs = Date.now() - waitStarted",
    "if (record === undefined) {",
    `  const seen = (await desktop.windows()).slice(0, 12).map((entry) => ({ app: entry.app, title: entry.title, pid: entry.pid }))`,
    `  return { kind: "error", message: \`no window titled ${target.title.replaceAll("`", "")} after waiting \${resolved.windowWaitMs} ms; engine lists \${JSON.stringify(seen)}\`, resolved }`,
    "}",
    "const win = await desktop.window(record.id)",
  ]
}

/** `run` code for one cell. It returns its own outcome, so a refusal is read from the engine's error code. */
export function cellCode(cell: Cell, target: FixtureTarget, windowWaitMs = 0): string {
  const body = [
    ...windowLookup(target, windowWaitMs),
    ...lookup("el", target.element),
    ...labelCheck(cell),
    ...CENTRE,
    ...AIM,
    ...aimLines(cell, target),
    ...actionLines(cell, target),
    'return { kind: "delivered", aim: aimed, resolved }',
  ]
  return [
    "const resolved = {}",
    "try {",
    ...body.map((line) => `  ${line}`),
    "} catch (error) {",
    "  const code = error?.data?.code",
    '  if (typeof code === "string") return { kind: "refused", code, resolved }',
    '  return { kind: "error", message: String(error?.message ?? error), resolved }',
    "}",
  ].join("\n")
}
