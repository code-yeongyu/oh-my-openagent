import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recompute } from "./fact-derive.mjs"
import { derive } from "./tests/derive-clock"
import { addRow, emptyLedger, readLedger, writeLedger } from "./fact-ledger.mjs"
import { HASH, EOK_WON, Row, Ledger, measured, ledgerOf, fixture, rowOf } from "./tests/fact-derive-support"



describe("unit rules: the design review's counterexamples", () => {
	const book = () =>
		ledgerOf([
			measured("F1", "20", "%"),
			measured("F2", "10", "%"),
			measured("F3", "5", "pp"),
			measured("F4", "25", "C", { valid_at: "2025", entity: "x" }),
			measured("F5", "30", "C", { valid_at: "2026", entity: "x" }),
			measured("F6", "200", "person"),
			measured("F7", "100", "person"),
			measured("F8", "100", "USD"),
			measured("F9", "20", "USD/person"),
			measured("F10", "0", "m"),
		])

	test("a sum of % operands without one shared reference is refused", () => {
		const ledger = book()
		const base = { op: "sum", operands: ["F1", "F2"], unit: "%", disjoint: true, rationale: "disjoint shares" }
		expect(derive(ledger, base).error).toBe("incompatible_operands")
		expect(derive(ledger, { ...base, reference: { F1: "voters", F2: "residents" } }).error).toBe("incompatible_operands")
		expect(rowOf(derive(ledger, { ...base, reference: { F1: "voters", F2: "voters" } }))).toMatchObject({ value: "30", unit: "%" })
	})

	test("20% - 5pp is 15%", () => {
		const row = rowOf(derive(book(), { op: "diff", operands: ["F1", "F3"], unit: "%" }))
		expect(row).toMatchObject({ value: "15", unit: "%", render: "15%" })
	})

	test("growth on a Celsius scale is refused", () => {
		const result = derive(book(), { op: "growth", from: "F4", to: "F5", unit: "%" })
		expect(result.error).toBe("incompatible_operands")
		expect(result.detail).toContain("affine")
	})

	test("temperatures are not summed or differenced as absolute values; ratio refuses them; convert C to F is allowed", () => {
		const ledger = book()
		const refused = [
			{ op: "sum", operands: ["F4", "F5"], unit: "C" },
			{ op: "diff", operands: ["F5", "F4"], unit: "C" },
			{ op: "expr", formula: "F4 + F5", unit: "C" },
			{ op: "expr", formula: "F5 - F4", unit: "C" },
			{ op: "ratio", num: "F5", den: "F4", unit: null },
		]
		for (const spec of refused) {
			const result = derive(ledger, spec)
			expect({ spec, error: result.error, detail: result.detail }).toEqual({ spec, error: "incompatible_operands", detail: expect.stringContaining("affine") })
		}
		const converted = rowOf(derive(ledger, { op: "convert", operands: ["F4"], to: "F" }))
		expect(converted).toMatchObject({ value: "77", unit: "F" })
		expect(recompute(ledger, converted).ok).toBe(true)
	})

	test("a convert row relabeled to an alias in both unit and context.target is detected", () => {
		const ledger = book()
		const row = rowOf(derive(ledger, { op: "convert", operands: ["F10"], to: "km" }))
		const relabeled = recompute(ledger, { ...row, unit: "kilometre", raw: "0 kilometre (0 m)", render: "0 kilometre (0 m)", context: { target: "kilometre" } })
		expect(relabeled.ok).toBe(false)
		expect(relabeled.detail).toContain('context.target "kilometre" is not canonical')
	})

	test("a share of 200 out of 100 is refused", () => {
		expect(derive(book(), { op: "share", part: "F6", whole: "F7", unit: "%" }).error).toBe("incompatible_operands")
	})

	test("100 USD / (20 USD/person) is 5 person", () => {
		const ledger = book()
		const row = rowOf(derive(ledger, { op: "ratio", num: "F8", den: "F9", unit: "person" }))
		expect(row).toMatchObject({ value: "5", unit: "person", exact: { num: "5", den: "1" } })
		expect(recompute(ledger, row).ok).toBe(true)
	})

	test("convert 0 m to km relabeled cm is detected though the value is unchanged", () => {
		const ledger = book()
		const row = rowOf(derive(ledger, { op: "convert", operands: ["F10"], to: "km" }))
		expect(recompute(ledger, row).ok).toBe(true)
		const relabeled = recompute(ledger, { ...row, unit: "cm", raw: "0 cm (0 m)", render: "0 cm (0 m)" })
		expect(relabeled.ok).toBe(false)
		expect(relabeled.detail).toContain("km")
	})

	test("expr % + %p is %, in either order; a ratio over unequal % and %p is refused", () => {
		const ledger = book()
		for (const formula of ["F1 + F3", "F3 + F1"]) {
			const row = rowOf(derive(ledger, { op: "expr", formula, unit: "%" }))
			expect(row).toMatchObject({ value: "25", unit: "%" })
			expect(recompute(ledger, row).ok).toBe(true)
		}
		const ratio = derive(ledger, { op: "ratio", num: "F1", den: "F3", unit: null })
		expect(ratio.error).toBe("incompatible_operands")
		expect(ratio.detail).toContain("needs equal units")
	})

	test("a stored context on an operation that has none is malformed", () => {
		const ledger = book()
		const diff = rowOf(derive(ledger, { op: "diff", operands: ["F1", "F2"], unit: "%p" }))
		const expr = rowOf(derive(ledger, { op: "expr", formula: "F1 - F2", unit: "%p" }))
		for (const [row, context] of [[diff, "x"], [expr, { target: "km" }]] as const) {
			const result = recompute(ledger, { ...row, context })
			expect(result.ok).toBe(false)
			expect(result.detail).toContain("rows carry no context")
		}
	})

	test("expr 20% - 10% is %p, never %", () => {
		const ledger = book()
		expect(derive(ledger, { op: "expr", formula: "F1 - F2", unit: "%" }).error).toBe("incompatible_operands")
		const row = rowOf(derive(ledger, { op: "expr", formula: "F1 - F2", unit: "%p" }))
		expect(row).toMatchObject({ value: "10", unit: "%p" })
		expect(recompute(ledger, row).ok).toBe(true)
	})
})

describe("render precision of expr results (invariant 5)", () => {
	const book = () => ledgerOf([measured("F1", "20.25", "%"), measured("F2", "15.5", "%"), measured("F3", "1000", "m"), measured("F4", "3", "m"), measured("F5", "12.34", "m")])

	test("an expr difference giving %p renders by decimal places, as diff does", () => {
		const ledger = book()
		const viaDiff = rowOf(derive(ledger, { op: "diff", operands: ["F1", "F2"], unit: "%p" }))
		const viaExpr = rowOf(derive(ledger, { op: "expr", formula: "F1 - F2", unit: "%p" }))
		expect(viaDiff).toMatchObject({ value: "4.8", render: "4.8 %p" })
		expect(viaExpr).toMatchObject({ value: "4.8", render: "4.8 %p" })
		expect(recompute(ledger, viaExpr).ok).toBe(true)
	})

	test("an expr with a - root renders 1000 m - 3 m as 997 m", () => {
		const ledger = book()
		const row = rowOf(derive(ledger, { op: "expr", formula: "F3 - F4", unit: "m" }))
		expect(row).toMatchObject({ value: "997", render: "997 m", exact: { num: "997", den: "1" } })
		expect(recompute(ledger, row).ok).toBe(true)
	})

	test("an expr with a * root keeps significant figures", () => {
		const ledger = book()
		const row = rowOf(derive(ledger, { op: "expr", formula: "F5 * 1.5", unit: "m" }))
		expect(row).toMatchObject({ value: "19", render: "19 m" })
		expect(recompute(ledger, row).ok).toBe(true)
	})
})
