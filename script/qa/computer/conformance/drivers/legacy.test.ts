import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { catalogFor } from "../catalog.ts"
import { buildReport } from "../report.ts"
import { isDriver } from "../driver.ts"
import type { Cell, CellResult } from "../vocabulary.ts"
import { createLegacyDriver, driver, type Fixtures, type Observer, readOutcome, type ShippedTool } from "./legacy.ts"
import type { FixtureTarget } from "./legacy-code.ts"

type Sent = { readonly verb: string; readonly args: readonly unknown[] }

const WINDOW = { x: 100, y: 50, width: 400, height: 300 }
const ELEMENT = { x: 110, y: 60, width: 20, height: 10 }

const TARGET: FixtureTarget = {
  app: "Conformance Fixture",
  title: "Document",
  element: { role: "button", title: "Press" },
  dragTo: { role: "row", title: "a" },
  menuPath: ["Edit", "Conformance"],
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

function facade(sent: Sent[], refuse?: string) {
  const record =
    (verb: string) =>
    async (...args: unknown[]) => {
      if (refuse !== undefined) throw Object.assign(new Error("refused"), { data: { code: refuse } })
      sent.push({ verb, args })
    }
  const element = {
    bounds: async () => ELEMENT,
    click: record("el.click"),
    type: record("el.type"),
    setValue: record("el.setValue"),
    press: record("el.press"),
    focus: async () => {},
  }
  const win = {
    bounds: WINDOW,
    find: async () => [element],
    screenshot: async () => ({ coordinateWidth: WINDOW.width * 2, coordinateHeight: WINDOW.height * 2 }),
    click: record("win.click"),
    type: record("win.type"),
    scroll: record("win.scroll"),
    drag: record("win.drag"),
    press: record("win.press"),
    menu: { select: record("win.menu.select") },
  }
  const listed = [{ id: "w1", app: "python3", title: TARGET.title, pid: 42 }]
  return {
    windows: async (filter?: { title?: string }) =>
      filter?.title === undefined ? listed : listed.filter((entry) => entry.title.includes(filter.title ?? "")),
    window: async (id: string) => {
      if (id !== "w1") throw new Error(`unknown window ${id}`)
      return win
    },
  }
}

function fakeTool(sent: Sent[], refuse?: string): ShippedTool & { calls: number } {
  const tool = {
    calls: 0,
    async execute(_id: string, input: Readonly<Record<string, unknown>>) {
      tool.calls += 1
      const value: unknown = await new AsyncFunction("desktop", String(input.code))(facade(sent, refuse))
      return { details: { value } }
    },
  }
  return tool
}

const fixtures = (read: unknown): Fixtures => ({
  target: () => TARGET,
  reset: async () => {},
  read: async () => read,
  resetTask: async () => {},
  saved: async () => ({}),
  stop: async () => {},
})

const observer: Observer = {
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

const cells = catalogFor("x11", "xorg")
const sessionDir = mkdtempSync(join(tmpdir(), "legacy-driver-test-"))
const session = () => sessionDir
afterAll(() => rmSync(sessionDir, { recursive: true, force: true }))

describe("legacy driver against the shipped run facade", () => {
  test("every catalog cell runs as valid run code against the shipped facade and sends input", async () => {
    for (const cell of cells) {
      const sent: Sent[] = []
      const result = await createLegacyDriver({
        session,
        settleMs: 0,
        tool: { ready: fakeTool(sent) },
        fixtures: { ready: fixtures(1) },
        observer: { ready: observer },
      }).runCell(cell)
      expect([result.id, result.observed]).toEqual([result.id, { kind: "delivered" }])
      expect([result.id, sent.length > 0]).toEqual([result.id, true])
      expect(result.oracle.observed).toBe(1)
    }
  })

  test("foreground cells ask for foreground delivery and background cells keep the shipped default", async () => {
    const delivery = async (cell: Cell) => {
      const sent: Sent[] = []
      await createLegacyDriver({
        session,
        settleMs: 0,
        tool: { ready: fakeTool(sent) },
        fixtures: { ready: fixtures(1) },
        observer: { ready: observer },
      }).runCell(cell)
      return sent[0]?.args.find((arg) => typeof arg === "object" && arg !== null && "delivery" in arg)
    }
    const click = (mode: Cell["mode"]) =>
      cells.find(
        (cell) => cell.action === "click" && cell.targeting === "ax" && cell.mode === mode && cell.toolkit === "native",
      )
    const foreground = click("foreground")
    const background = click("background")
    if (foreground === undefined || background === undefined) throw new Error("catalog has no native ax click")
    expect(await delivery(foreground)).toEqual({ delivery: "foreground" })
    expect(await delivery(background)).toBeUndefined()
  })

  test("a pixel cell aims at the element centre in the window capture's frame", async () => {
    const cell = cells.find(
      (entry) => entry.action === "click" && entry.targeting === "px" && entry.mode === "background",
    )
    if (cell === undefined) throw new Error("catalog has no px click")
    const sent: Sent[] = []
    await createLegacyDriver({
      session,
      settleMs: 0,
      tool: { ready: fakeTool(sent) },
      fixtures: { ready: fixtures(1) },
      observer: { ready: observer },
    }).runCell(cell)
    expect(sent[0]?.args.slice(0, 2)).toEqual([(110 + 10 - 100) * 2, (60 + 5 - 50) * 2])
  })

  test("an engine refusal is recorded with its code and without a nothingSent claim", async () => {
    const [cell] = cells
    if (cell === undefined) throw new Error("empty catalog")
    const result = await createLegacyDriver({
      session,
      settleMs: 0,
      tool: { ready: fakeTool([], "BackgroundUnavailable") },
      fixtures: { ready: fixtures(0) },
      observer: { ready: observer },
    }).runCell(cell)
    expect(result.observed).toEqual({ kind: "refused", code: "BackgroundUnavailable", nothingSent: false })
    expect(readOutcome({ isError: true, details: { value: { code: "ControlRequired" } } })).toEqual({
      kind: "refused",
      code: "ControlRequired",
      nothingSent: false,
    })
  })

  test("a missing fixture records not_run and sends nothing", async () => {
    const [cell] = cells
    if (cell === undefined) throw new Error("empty catalog")
    const tool = fakeTool([])
    const noFixture = await createLegacyDriver({
      session,
      settleMs: 0,
      tool: { ready: tool },
      fixtures: { unavailable: "no fixture" },
      observer: { ready: observer },
    }).runCell(cell)
    const noToolkit = await createLegacyDriver({
      session,
      settleMs: 0,
      tool: { ready: tool },
      fixtures: { ready: { ...fixtures(1), target: () => ({ unavailable: "no electron app" }) } },
      observer: { ready: observer },
    }).runCell(cell)
    expect(noFixture.observed).toEqual({ kind: "not_run", reason: "fixture_unavailable: no fixture" })
    expect(noToolkit.observed).toEqual({ kind: "not_run", reason: "fixture_unavailable: no electron app" })
    expect(tool.calls).toBe(0)
  })

  test("without an observer the cell still runs, every signal reads not_observed, and the report never passes it", async () => {
    const cell = cells.find((entry) => "deliver" in entry.expect && entry.mode === "background")
    if (cell === undefined) throw new Error("catalog has no background deliver cell")
    const sent: Sent[] = []
    const result = await createLegacyDriver({
      session,
      settleMs: 0,
      tool: { ready: fakeTool(sent) },
      fixtures: { ready: fixtures(cell.oracle.equals) },
      observer: { unavailable: "no recorder for this OS" },
    }).runCell(cell)
    expect(result.observed).toEqual({ kind: "delivered" })
    expect(sent.length).toBeGreaterThan(0)
    expect(result.observerUnavailable).toBe("no recorder for this OS")
    expect(new Set(Object.values(result.journal).map((summary) => summary.signal))).toEqual(new Set(["not_observed"]))
    const report = buildReport([cell], [result])
    expect([report.delivered, report.unobserved]).toEqual([0, 1])
  })

  test("a missing fixture window is an error naming the windows the engine listed, and sends nothing", async () => {
    const [cell] = cells
    if (cell === undefined) throw new Error("empty catalog")
    const sent: Sent[] = []
    const result = await createLegacyDriver({
      session,
      settleMs: 0,
      tool: { ready: fakeTool(sent) },
      fixtures: { ready: { ...fixtures(0), target: () => ({ ...TARGET, title: "Missing" }) } },
      observer: { ready: observer },
    }).runCell(cell)
    expect(result.observed.kind).toBe("error")
    expect(result.observed.kind === "error" && result.observed.message).toContain('"app":"python3"')
    expect(sent.length).toBe(0)
  })

  // run.ts loads drivers/<name>.ts by path and accepts only a module whose `driver` passes isDriver.
  test("the module's driver is one run.ts accepts", () => {
    expect(isDriver(driver)).toBe(true)
  })
})
