import { expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { derive } from "./fact-derive.mjs"
import { fill } from "./fact-fill.mjs"
import { addRow, emptyLedger } from "./fact-ledger.mjs"
import { kindRuleErrors, readFlaws } from "./fact-ledger-kinds.mjs"
import { valueChecks } from "./fidelity-values.mjs"
import { buildContext } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"
import { parsePlaceholder, valueParts } from "./placeholder.mjs"
import { checkMetadata } from "./unit-metadata.mjs"

const NOW = "2026-10-23T08:00:00Z"
const FIX = join(import.meta.dir, "tests", "fixtures", "fidelity")
const fixture = () => JSON.parse(readFileSync(join(FIX, "ledger-verify.json"), "utf8"))
const book = () => {
	const ledger = emptyLedger() as { schemaVersion: number; rows: Record<string, unknown>[]; events: unknown[] }
	for (const value of ["3", "1"]) addRow(ledger, { kind: "measured", value, unit: "m", raw: value + " m", quote: value + " m", source_id: "S1", locator: { artifact: "text.txt", char_start: 0, char_end: 3 }, snapshot_sha256: "a".repeat(64), extracted_by: "test", observed_at: NOW, label: "length-" + value })
	return ledger
}

test("quoted CSV labels preserve fact_id plot_value and unit columns", () => {
	const dir = mkdtempSync(join(tmpdir(), "value-csv-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	writeFileSync(join(dir, "chart.csv"), 'fact_id,label,plot_value,unit\nF5,"a, b",12,%\n')
	const ctx = buildContext(parseHtml('<figure data-chart-source="chart.csv"><svg><text>12%</text></svg></figure>'), { baseDir: dir })
	expect(valueChecks(ctx, fixture(), null, null)).toEqual([])
})

test("quote exact with unknown keys still violates the quote null rule", () => {
	const quote = fixture().rows.find((r: { fact_id: string }) => r.fact_id === "Q1")
	expect(kindRuleErrors({ ...quote, exact: { num: "3", den: "1", note: "x" } }, "Q1")).toContain("Q1.exact must be null for a quote row")
})

test("negative decimal zero agrees with exact zero in dimension 32", () => {
	const row = book().rows[0]
	expect(readFlaws({ ...row, value: "-0.0", exact: { num: "0", den: "1" } })).toEqual([])
})

test("derive without caller time refuses without appending", () => {
	const ledger = book()
	expect(derive(ledger, { op: "diff", operands: ["F1", "F2"], unit: "m" })).toMatchObject({ error: "missing_now", shape: "missing_now" })
	expect(ledger.rows).toHaveLength(2)
})

test("addRow validation errors are not incompatible operands", () => {
	const ledger = book()
	expect(() => derive(ledger, { op: "diff", operands: ["F1", "F2"], unit: "m", now: NOW, label: "invalid label" })).toThrow("invalid fact ledger")
	expect(ledger.rows).toHaveLength(2)
})

test("prefix currency value uses the original source text", () => {
	expect(valueParts({ raw: "$4.2m", unit: "USD", value: "4200000" }).valueText).toBe("$4.2m")
})

test("zero padded placeholder id is rejected during parsing", () => {
	expect(parsePlaceholder("{{F012:x}}")).toMatchObject({ error: expect.stringContaining("id") })
})

test("literal opening braces fail with an actionable escape", () => {
	const result = fill("Example: \u0060{{\u0060", { rows: [] }, { format: "md" })
	expect(result.errors).toEqual([expect.objectContaining({ code: "unresolved_placeholder", message: expect.stringContaining("&#123;") })])
})

test("null metadata matches null but never a declared population", () => {
	const a = book().rows[0]
	expect(() => checkMetadata([a, { ...a }], ["population"])).not.toThrow()
	expect(() => checkMetadata([a, { ...a, population: "all" }], ["population"])).toThrow("population differs")
})
