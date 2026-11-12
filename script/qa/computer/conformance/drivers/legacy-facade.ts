// The shipped run facade, faked for the legacy driver's tests: it records every verb the cell code sends, refuses with a
// given engine code, and lists a field with or without a caption of the same name.

import type { CellResult } from "../vocabulary.ts"
import type { Fixtures, Observer, ShippedTool } from "./legacy.ts"
import type { FixtureTarget } from "./legacy-code.ts"

export type Sent = { readonly verb: string; readonly args: readonly unknown[] }

const WINDOW = { x: 100, y: 50, width: 400, height: 300 }
const ELEMENT = { x: 110, y: 60, width: 20, height: 10 }

export const TARGET: FixtureTarget = {
  title: "Conformance Document",
  element: { role: "button", title: "Press" },
  dragTo: { role: "row", title: "a" },
  menuPath: ["Edit", "Conformance"],
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

// "captioned": the window lists a caption of the same name before the field, as both fixture apps do; "caption-only":
// the caption is all it lists.
export type Listing = "field" | "captioned" | "caption-only"

// What the engine's hit-test answers at a point inside the element: the element itself, the window's untitled root
// (the x11 release), or another titled element; "offscreen" puts the element outside the window.
export type HitTest = "element" | "root" | "other" | "offscreen"

const OFFSCREEN = { x: 900, y: 900, width: 20, height: 10 }

function facade(sent: Sent[], refuse?: string, listing: Listing = "field", hit: HitTest = "element") {
  const record =
    (verb: string) =>
    async (...args: unknown[]) => {
      if (refuse !== undefined) throw Object.assign(new Error("refused"), { data: { code: refuse } })
      sent.push({ verb, args })
    }
  const element = {
    bounds: async () => (hit === "offscreen" ? OFFSCREEN : ELEMENT),
    click: record("el.click"),
    type: record("el.type"),
    setValue: record("el.setValue"),
    press: record("el.press"),
    focus: async () => {},
  }
  const caption = {
    role: "statictext",
    bounds: async () => ({ x: 102, y: 60, width: 6, height: 10 }),
    click: record("caption.click"),
    type: record("caption.type"),
    setValue: record("caption.setValue"),
    press: record("caption.press"),
    focus: record("caption.focus"),
  }
  const field = { ...element, role: "textfield" }
  const found = { field: [element], captioned: [caption, field], "caption-only": [caption] }[listing]
  const win = {
    bounds: WINDOW,
    find: async () => found,
    screenshot: async () => ({ coordinateWidth: WINDOW.width * 2, coordinateHeight: WINDOW.height * 2 }),
    click: record("win.click"),
    type: record("win.type"),
    scroll: record("win.scroll"),
    drag: record("win.drag"),
    press: record("win.press"),
    menu: { select: record("win.menu.select") },
  }
  const listed = [{ id: "w1", app: "python3", title: TARGET.title, pid: 42 }]
  const inside = (x: number, y: number) =>
    x >= ELEMENT.x && x <= ELEMENT.x + ELEMENT.width && y >= ELEMENT.y && y <= ELEMENT.y + ELEMENT.height
  return {
    elementAt: async (x: number, y: number) => {
      if (!inside(x, y)) return null
      if (hit === "root") return { role: "filler", title: null }
      return { role: "button", title: hit === "other" ? "Elsewhere" : TARGET.element.title }
    },
    windows: async (filter?: { title?: string }) =>
      filter?.title === undefined ? listed : listed.filter((entry) => entry.title.includes(filter.title ?? "")),
    window: async (id: string) => {
      if (id !== "w1") throw new Error(`unknown window ${id}`)
      return win
    },
  }
}

export function fakeTool(
  sent: Sent[],
  refuse?: string,
  listing?: Listing,
  hit?: HitTest,
): ShippedTool & { calls: number } {
  const tool = {
    calls: 0,
    async execute(_id: string, input: Readonly<Record<string, unknown>>) {
      tool.calls += 1
      const value: unknown = await new AsyncFunction("desktop", String(input.code))(facade(sent, refuse, listing, hit))
      return { details: { value } }
    },
  }
  return tool
}

export const fixtures = (read: unknown): Fixtures => ({
  target: () => TARGET,
  reset: async () => {},
  read: async () => read,
  resetTask: async () => {},
  saved: async () => ({}),
  stop: async () => {},
})

export const observer: Observer = {
  async observe(act) {
    return { value: await act(), journal: emptyJournal() }
  },
}

function emptyJournal(): CellResult["journal"] {
  const none = { signal: "none", firstAt: null, count: 0 } as const
  return {
    key_focus: none,
    window_raised: none,
    typing: none,
    pointer: none,
    clipboard: none,
    space: none,
    dialog: none,
    activation: none,
  }
}
