import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Cell, cellId, type CellResult, catalogFor, type SignalId, type SignalSummary } from "./catalog.ts"
import { buildReport, summaryLine } from "./report.ts"

const deliverCell: Cell = {
  os: "fake",
  session: "headless",
  persona: "macos",
  toolkit: "native",
  action: "typeText",
  targeting: "ax",
  mode: "background",
  expect: { deliver: true },
  declares: [],
  oracle: { field: "value", equals: "hello" },
  basis: "report test",
}

const refuseCell: Cell = {
  ...deliverCell,
  action: "drag",
  targeting: "px",
  expect: { refuse: ["BackgroundUnavailable"] },
  oracle: { field: "dragOrder", equals: "a,b,c" },
}

const foregroundCell: Cell = {
  ...deliverCell,
  mode: "foreground",
  declares: ["window_raised", "activation", "key_focus"],
}

const catalog = [deliverCell, refuseCell, foregroundCell]

function quiet(): Record<SignalId, SignalSummary> {
  const none: SignalSummary = { signal: "none", firstAt: null, count: 0 }
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

function happened(...ids: SignalId[]): Record<SignalId, SignalSummary> {
  const journal = quiet()
  for (const id of ids) journal[id] = { signal: "happened", firstAt: 120, count: 1 }
  return journal
}

function delivered(cell: Cell, journal = quiet()): CellResult {
  return {
    id: cellId(cell),
    observed: { kind: "delivered" },
    oracle: { observed: cell.oracle.equals },
    durationMs: 40,
    journal,
  }
}

function refused(cell: Cell, code: string, nothingSent = true): CellResult {
  return {
    id: cellId(cell),
    observed: { kind: "refused", code, nothingSent },
    oracle: { observed: cell.oracle.equals },
    durationMs: 40,
    journal: quiet(),
  }
}

function passingRun(
  first = delivered(deliverCell),
  second = refused(refuseCell, "BackgroundUnavailable"),
  third = delivered(foregroundCell),
): CellResult[] {
  return [first, second, third]
}

describe("conformance report, declared-outcome catalog [ADP-1]", () => {
  test("a complete run with every declared outcome passes", () => {
    const report = buildReport(catalog, passingRun())
    expect(report.problems).toEqual([])
    expect(summaryLine(report)).toBe("CATALOG fake/headless cells=3 delivered=2 refused=1 failed=0 skipped=0")
  })

  test("a missing cell fails the report and is named", () => {
    const report = buildReport(catalog, passingRun().slice(1))
    expect(report.problems).toEqual([`missing cell ${cellId(deliverCell)}`])
    expect(report.failed).toBe(1)
  })

  test("a duplicate cell fails the report", () => {
    const report = buildReport(catalog, [...passingRun(), delivered(deliverCell)])
    expect(report.problems).toEqual([`duplicate cell ${cellId(deliverCell)}`])
    expect(report.failed).toBe(1)
  })

  test("a skipped cell fails the report and is counted as skipped", () => {
    const skipped: CellResult = {
      ...delivered(deliverCell),
      observed: { kind: "not_run", reason: "fixture app missing" },
    }
    const report = buildReport(catalog, passingRun(skipped))
    expect(report.problems).toEqual([`skipped cell ${cellId(deliverCell)}: fixture app missing`])
    expect(report.skipped).toBe(1)
    expect(summaryLine(report)).toEndWith("failed=0 skipped=1")
  })

  test("a refusal with a different code fails the report", () => {
    const report = buildReport(catalog, passingRun(undefined, refused(refuseCell, "InputFailed")))
    expect(report.problems).toEqual([
      `cell ${cellId(refuseCell)}: expected refused BackgroundUnavailable, observed refused InputFailed`,
    ])
  })

  test("a refusal that sent something fails even with the right code", () => {
    const report = buildReport(catalog, passingRun(undefined, refused(refuseCell, "BackgroundUnavailable", false)))
    expect(report.problems).toEqual([`cell ${cellId(refuseCell)}: refused without nothingSent`])
  })

  test("a delivered background cell with a non-empty observer journal fails the report", () => {
    const report = buildReport(catalog, passingRun(delivered(deliverCell, happened("window_raised"))))
    expect(report.problems).toEqual([`cell ${cellId(deliverCell)}: observer journal not empty: window_raised`])
  })

  test("a foreground cell may change only the signals it declares", () => {
    const declared = delivered(foregroundCell, happened("window_raised", "activation"))
    expect(buildReport(catalog, passingRun(undefined, undefined, declared)).problems).toEqual([])
    const undeclared = delivered(foregroundCell, happened("window_raised", "clipboard"))
    expect(buildReport(catalog, passingRun(undefined, undefined, undeclared)).problems).toEqual([
      `cell ${cellId(foregroundCell)}: observer journal not empty: clipboard`,
    ])
  })

  test("a refusal passes only with an empty observer journal", () => {
    const noisy = { ...refused(refuseCell, "BackgroundUnavailable"), journal: happened("pointer") }
    expect(buildReport(catalog, passingRun(undefined, noisy)).problems).toEqual([
      `cell ${cellId(refuseCell)}: observer journal not empty: pointer`,
    ])
  })

  test("a deliver cell that the hand refused fails with the declared and observed outcome", () => {
    expect(buildReport(catalog, passingRun(refused(deliverCell, "BackgroundUnavailable"))).problems).toEqual([
      `cell ${cellId(deliverCell)}: expected deliver, observed refused BackgroundUnavailable`,
    ])
  })

  test("a refusal cell that the hand delivered fails", () => {
    expect(buildReport(catalog, passingRun(undefined, delivered(refuseCell))).problems).toEqual([
      `cell ${cellId(refuseCell)}: expected refused BackgroundUnavailable, observed delivered`,
    ])
  })

  test("a cell whose run ended in an error fails", () => {
    const broken: CellResult = { ...delivered(deliverCell), observed: { kind: "error", message: "engine exited" } }
    expect(buildReport(catalog, passingRun(broken)).problems).toEqual([
      `cell ${cellId(deliverCell)}: error: engine exited`,
    ])
  })

  test("a delivered cell whose fixture oracle does not hold fails", () => {
    const wrong = { ...delivered(deliverCell), oracle: { observed: "hell" } }
    expect(buildReport(catalog, passingRun(wrong)).problems).toEqual([
      `cell ${cellId(deliverCell)}: oracle value == "hello" does not hold (fixture reads "hell")`,
    ])
  })

  test("a refusal whose fixture state changed fails even though the hand refused", () => {
    const touched = { ...refused(refuseCell, "BackgroundUnavailable"), oracle: { observed: "b,a,c" } }
    expect(buildReport(catalog, passingRun(undefined, touched)).problems).toEqual([
      `cell ${cellId(refuseCell)}: oracle dragOrder == "a,b,c" does not hold (fixture reads "b,a,c")`,
    ])
  })

  test("an observer journal entry that contradicts itself fails", () => {
    const journal = { ...quiet(), pointer: { signal: "none" as const, firstAt: 50, count: 7 } }
    expect(buildReport(catalog, passingRun(delivered(deliverCell, journal))).problems).toEqual([
      `cell ${cellId(deliverCell)}: observer journal contradicts itself: pointer`,
    ])
  })

  test("a result for a cell the catalog does not declare fails", () => {
    const stray = { ...deliverCell, toolkit: "webview" as const }
    const report = buildReport(catalog, [...passingRun(), delivered(stray)])
    expect(report.problems).toEqual([`undeclared cell ${cellId(stray)}`])
  })

  test("a catalog that declares one cell twice is contradictory", () => {
    const report = buildReport([...catalog, { ...deliverCell, expect: { refuse: ["InputFailed"] } }], passingRun())
    expect(report.problems).toContain(`contradictory cell ${cellId(deliverCell)}: declared 2 times`)
  })

  test("the CLI names the missing cell of a finished run and exits 1", () => {
    const fake = catalogFor("fake", "headless")
    const results = fake.map((cell) =>
      "deliver" in cell.expect ? delivered(cell) : refused(cell, cell.expect.refuse[0] ?? "no declared code"),
    )
    const dir = mkdtempSync(join(tmpdir(), "conformance-report-"))
    try {
      const input = join(dir, "run.json")
      const write = (rows: CellResult[]) =>
        writeFileSync(
          input,
          JSON.stringify({
            schema: "omo-conformance-run/1",
            driver: "engine",
            os: "fake",
            session: "headless",
            results: rows,
          }),
        )
      write(results)
      const ok = Bun.spawnSync(["bun", join(import.meta.dir, "report.ts"), "--input", input])
      expect(ok.stdout.toString()).toContain(`CATALOG fake/headless cells=${fake.length} `)
      expect(ok.exitCode).toBe(0)
      const [dropped, ...rest] = results
      write(rest)
      const missing = Bun.spawnSync(["bun", join(import.meta.dir, "report.ts"), "--input", input])
      expect(missing.stdout.toString()).toContain(`missing cell ${dropped?.id}`)
      expect(missing.exitCode).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
