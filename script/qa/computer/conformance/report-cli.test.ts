import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Cell, cellId, type CellResult, catalogFor, type SignalSummary } from "./catalog.ts"

const reportScript = join(import.meta.dir, "report.ts")
const none: SignalSummary = { signal: "none", firstAt: null, count: 0 }
const quiet = {
  key_focus: none,
  window_raised: none,
  typing: none,
  pointer: none,
  clipboard: none,
  space: none,
  dialog: none,
  activation: none,
}

function asDeclared(cell: Cell): CellResult {
  const observed =
    "deliver" in cell.expect
      ? { kind: "delivered" as const }
      : { kind: "refused" as const, code: cell.expect.refuse[0] ?? "no declared code", nothingSent: true }
  return { id: cellId(cell), observed, oracle: { observed: cell.oracle.equals }, durationMs: 1, journal: quiet }
}

const fake = catalogFor("fake", "headless")
const complete = fake.map(asDeclared)

function report(rows: unknown, ...flags: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "conformance-report-cli-"))
  try {
    const input = join(dir, "run.json")
    writeFileSync(
      input,
      JSON.stringify({
        schema: "omo-conformance-run/1",
        driver: "legacy",
        os: "fake",
        session: "headless",
        results: rows,
      }),
    )
    const child = Bun.spawnSync(["bun", reportScript, "--input", input, ...flags])
    return { stdout: child.stdout.toString(), exitCode: child.exitCode }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function withFailures(): CellResult[] {
  const raiser = fake.findIndex((cell) => "deliver" in cell.expect && cell.mode === "background")
  const refusal = fake.findIndex((cell) => "refuse" in cell.expect)
  const blind = fake.findIndex((cell, index) => index > raiser && "deliver" in cell.expect)
  const raised = { signal: "happened" as const, firstAt: 80, count: 1 }
  const unread = { signal: "not_observed" as const, firstAt: null, count: 0 }
  return complete.map((result, index): CellResult => {
    if (index === raiser) return { ...result, journal: { ...quiet, window_raised: raised } }
    if (index === blind)
      return { ...result, journal: { ...quiet, clipboard: unread }, observerUnavailable: "no recorder" }
    if (index === refusal) return { ...result, observed: { kind: "refused", code: "InputFailed", nothingSent: true } }
    return result
  })
}

describe("report.ts command line", () => {
  test("names the missing cell of a finished run and exits 1", () => {
    expect(report(complete).stdout).toContain(`CATALOG fake/headless cells=${fake.length} `)
    const [dropped, ...rest] = complete
    const missing = report(rest)
    expect(missing.stdout).toContain(`missing cell ${dropped?.id}`)
    expect(missing.exitCode).toBe(1)
  })

  test("--check-schema accepts a complete run whose cells fail and rejects one with a cell removed", () => {
    const failing = report(withFailures(), "--check-schema")
    expect(failing.stdout).toContain(`SCHEMA ok fake/headless cells=${fake.length}`)
    expect(failing.exitCode).toBe(0)
    const [dropped, ...rest] = complete
    const missing = report(rest, "--check-schema")
    expect(missing.stdout).toContain(`missing cell ${dropped?.id}`)
    expect(missing.exitCode).toBe(1)
    expect(report([{ id: "x" }], "--check-schema").exitCode).toBe(1)
  })

  test("--summary prints every count, disturbed and unobserved cells included", () => {
    const summary = report(withFailures(), "--summary")
    const delivered = fake.filter((cell) => "deliver" in cell.expect).length
    expect(summary.stdout.trim()).toBe(
      `cells=${fake.length} delivered=${delivered - 2} refused=${fake.length - delivered - 1} failed=2 disturbed=1 unobserved=1`,
    )
    expect(summary.exitCode).toBe(0)
  })
})
