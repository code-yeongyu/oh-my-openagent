import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { catalogFor } from "../catalog.ts"
import { buildReport } from "../report.ts"
import { isDriver } from "../driver.ts"
import type { Cell } from "../vocabulary.ts"
import { createLegacyDriver, driver, type Fixtures, readOutcome } from "./legacy.ts"
import { fakeTool, fixtures, type HitTest, type Listing, observer, type Sent, TARGET } from "./legacy-facade.ts"

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

  test("a cell acts on the field, never on a caption of the same name, and a typing cell refuses a caption", async () => {
    const run = (cell: Cell, listing: Listing, sent: Sent[]) =>
      createLegacyDriver({
        session,
        settleMs: 0,
        tool: { ready: fakeTool(sent, undefined, listing) },
        fixtures: { ready: fixtures(1) },
        observer: { ready: observer },
      }).runCell(cell)
    for (const cell of cells) {
      const sent: Sent[] = []
      const result = await run(cell, "captioned", sent)
      expect([result.id, result.observed]).toEqual([result.id, { kind: "delivered" }])
      expect([result.id, sent.filter((entry) => entry.verb.startsWith("caption."))]).toEqual([result.id, []])
    }
    for (const cell of cells.filter((entry) => ["typeText", "ax.setValue", "keyChord"].includes(entry.action))) {
      const sent: Sent[] = []
      const result = await run(cell, "caption-only", sent)
      expect([result.id, result.observed.kind, sent]).toEqual([result.id, "error", []])
    }
  })

  test("a pixel cell is decided by geometry: the hit-test answer is recorded, and only a point off the target sends nothing", async () => {
    const pixel = cells.filter((entry) => entry.targeting === "px")
    const run = (cell: Cell, hit: HitTest, sent: Sent[]) =>
      createLegacyDriver({
        session,
        settleMs: 0,
        tool: { ready: fakeTool(sent, undefined, undefined, hit) },
        fixtures: { ready: fixtures(1) },
        observer: { ready: observer },
      }).runCell(cell)
    const logged: string[] = []
    const log = console.log
    console.log = (line: unknown) => void logged.push(String(line))
    try {
      for (const cell of pixel) {
        for (const hit of ["root", "other"] as const) {
          const sent: Sent[] = []
          logged.length = 0
          const result = await run(cell, hit, sent)
          expect([cell.action, hit, result.observed.kind, sent.length > 0]).toEqual([
            cell.action,
            hit,
            "delivered",
            true,
          ])
          expect([cell.action, hit, logged.some((line) => line.includes("hit_test_matches_target=false"))]).toEqual([
            cell.action,
            hit,
            true,
          ])
        }
        const offscreen: Sent[] = []
        const result = await run(cell, "offscreen", offscreen)
        expect([cell.action, result.observed.kind, offscreen]).toEqual([cell.action, "error", []])
      }
    } finally {
      console.log = log
    }
  })

  test("a fixture report that is briefly busy is read again, and any other read error still fails the cell", async () => {
    const [cell] = cells
    if (cell === undefined) throw new Error("empty catalog")
    const flaky = (error: Error): Fixtures => {
      let calls = 0
      return {
        ...fixtures(1),
        read: async () => {
          calls += 1
          if (calls === 1) throw error
          return 1
        },
      }
    }
    const run = (ready: Fixtures) =>
      createLegacyDriver({
        session,
        settleMs: 1_000,
        tool: { ready: fakeTool([]) },
        fixtures: { ready },
        observer: { ready: observer },
      }).runCell(cell)
    const busy = Object.assign(new Error("resource busy or locked"), { code: "EBUSY" })
    expect((await run(flaky(busy))).oracle.observed).toBe(1)
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" })
    await expect(run(flaky(denied))).rejects.toThrow("permission denied")
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
