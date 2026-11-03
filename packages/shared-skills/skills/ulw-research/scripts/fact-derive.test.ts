import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recompute } from "./fact-derive.mjs"
import { derive } from "./tests/derive-clock"
import { addRow, emptyLedger, readLedger, writeLedger } from "./fact-ledger.mjs"
import { HASH, EOK_WON, Row, Ledger, measured, ledgerOf, fixture, rowOf } from "./tests/fact-derive-support"



describe("derive: checked operations", () => {
	test("sum of compatible rows stores the exact sum and appends a derived row", () => {
		const ledger = fixture()
		const row = rowOf(derive(ledger, { op: "sum", operands: ["F5", "F6"], unit: EOK_WON }))
		// unit-rules.md: derived rows store the canonical unit text, so the input alias is stored as its table token.
		expect(row).toMatchObject({ fact_id: "F31", kind: "derived", operation: "sum", value: "300", unit: "KRW-e8", exact: { num: "300", den: "1" } })
		expect(row.operands).toEqual(["F5", "F6"])
		expect(row.derived_from).toEqual(["F5", "F6"])
		expect(ledger.rows.at(-1)).toBe(row)
	})

	test("sum across declared populations is incompatible and writes nothing", () => {
		const ledger = fixture()
		const result = derive(ledger, { op: "sum", operands: ["F5", "F7"], unit: EOK_WON })
		expect(result.error).toBe("incompatible_operands")
		expect(result.detail).toContain("population")
		expect(ledger.rows).toHaveLength(9)
	})

	test("percent operands: plain sum refused, pp diff and disjoint sum allowed", () => {
		const ledger = fixture()
		expect(derive(ledger, { op: "sum", operands: ["F8", "F9"], unit: "%" }).error).toBe("incompatible_operands")
		expect(derive(ledger, { op: "diff", operands: ["F9", "F8"], unit: "%" }).error).toBe("incompatible_operands")
		// unit-rules.md: `pp` is an input alias; the stored unit is canonical `%p`.
		expect(rowOf(derive(ledger, { op: "diff", operands: ["F9", "F8"], unit: "pp" }))).toMatchObject({ value: "5", unit: "%p" })
		expect(derive(ledger, { op: "sum", operands: ["F8", "F9"], unit: "%", disjoint: true }).error).toBe("incompatible_operands")
		// unit-rules.md: a % sum also needs one shared reference (denominator), persisted in context.
		expect(derive(ledger, { op: "sum", operands: ["F8", "F9"], unit: "%", disjoint: true, rationale: "x" }).error).toBe("incompatible_operands")
		const disjoint = rowOf(derive(ledger, { op: "sum", operands: ["F8", "F9"], unit: "%", disjoint: true, reference: "all", rationale: "x" }))
		expect(disjoint).toMatchObject({ value: "35", unit: "%", rationale: "x", context: { disjoint: true, reference: "all" } })
	})

	test("growth needs two periods of the same entity", () => {
		const ledger = fixture()
		const row = rowOf(derive(ledger, { op: "growth", from: "F19", to: "F20", unit: "%" }))
		expect(row).toMatchObject({ value: "12", unit: "%", exact: { num: "12", den: "1" }, operands: ["F19", "F20"] })
		addRow(ledger, measured("F21", "105", "case", { valid_at: "2025-Q3", entity: "acme" }))
		const same = derive(ledger, { op: "growth", from: "F19", to: "F21", unit: "%" })
		expect(same.error).toBe("incompatible_operands")
		expect(same.detail).toContain("valid_at")
	})

	test("an unknown or missing operand is refused", () => {
		const ledger = fixture()
		expect(derive(ledger, { op: "sum", operands: ["F5", "F99"], unit: EOK_WON }).error).toBe("incompatible_operands")
		expect(ledger.rows).toHaveLength(9)
	})
})

describe("derive: rendered precision", () => {
	const precision = () =>
		ledgerOf([measured("F1", "1000", "m"), measured("F2", "3", "m"), measured("F3", "9", "m"), measured("F4", "1.5", "m"), measured("F5", "20.25", "%"), measured("F6", "15.5", "%"), measured("F7", "19.0", "m")])

	test("a difference keeps the fewest decimal places: 1000 m - 3 m is 997 m", () => {
		const row = rowOf(derive(precision(), { op: "diff", operands: ["F1", "F2"], unit: "m" }))
		expect(row).toMatchObject({ value: "997", render: "997 m", exact: { num: "997", den: "1" } })
	})

	test("a difference keeps the fewest decimal places: 9 m - 1.5 m is 8 m, 19.0 m - 1.5 m is 17.5 m", () => {
		const ledger = precision()
		expect(rowOf(derive(ledger, { op: "diff", operands: ["F3", "F4"], unit: "m" }))).toMatchObject({ value: "8", render: "8 m", exact: { num: "15", den: "2" } })
		expect(rowOf(derive(ledger, { op: "diff", operands: ["F7", "F4"], unit: "m" }))).toMatchObject({ value: "17.5", render: "17.5 m", exact: { num: "35", den: "2" } })
	})

	test("pp with mixed decimal places rounds to the fewest: 20.25 % - 15.5 % is 4.8 pp", () => {
		const ledger = precision()
		const row = rowOf(derive(ledger, { op: "diff", operands: ["F5", "F6"], unit: "pp" }))
		// unit-rules.md: the canonical delta unit is `%p`; precision is unchanged.
		expect(row).toMatchObject({ value: "4.8", unit: "%p", render: "4.8 %p", exact: { num: "19", den: "4" } })
		expect(recompute(ledger, row).ok).toBe(true)
	})
})

describe("derive: convert", () => {
	test("320 m to mm keeps the original beside the converted value", () => {
		const ledger = fixture()
		const row = rowOf(derive(ledger, { op: "convert", operands: ["F12"], to: "mm" }))
		expect(row).toMatchObject({ kind: "converted", operation: "convert", value: "320000", unit: "mm", factor: "1000", render: "320,000 mm (320 m)" })
		expect(row.exact).toEqual({ num: "320000", den: "1" })
		expect(row.derived_from).toEqual(["F12"])
	})

	test("3.2 m to cm renders 320 cm at the original precision", () => {
		const ledger = fixture()
		const row = rowOf(derive(ledger, { op: "convert", operands: ["F30"], to: "cm" }))
		expect(row.value).toBe("320")
		expect(String(row.render).startsWith("320 cm")).toBe(true)
		expect(String(row.render)).not.toContain("320.0")
	})

	test("currency conversion is refused with a hint to expr", () => {
		const ledger = fixture()
		const result = derive(ledger, { op: "convert", operands: ["F5"], to: "USD" })
		expect(result.error).toBe("incompatible_operands")
		expect(result.hint).toContain("expr")
		expect(ledger.rows).toHaveLength(9)
	})
})

describe("derive: expr and exact chaining", () => {
	// unit-rules.md: expr units are inferred with no rationale escape, and an omitted unit is an error, not null.
	test("expr needs a declared unit that follows from its operands", () => {
		const ledger = fixture()
		expect(derive(ledger, { op: "expr", formula: "F12 / F30", rationale: "span over sample length" }).error).toBe("incompatible_operands")
		expect(derive(ledger, { op: "expr", formula: "F12 / F30", unit: "m" }).error).toBe("incompatible_operands")
		const result = derive(ledger, { op: "expr", formula: "F12 / F30", unit: null })
		expect(result.compatibility).toBe("unchecked")
		expect(rowOf(result)).toMatchObject({ value: "100", formula: "F12 / F30", operands: ["F12", "F30"] })
	})

	test("expr refuses unsupported tokens and absent ids", () => {
		const ledger = fixture()
		for (const formula of ["F12 ** 2", "Math.max(F12)", "F12 / F404", "F12 / 0", "(F12"]) {
			expect(derive(ledger, { op: "expr", formula, unit: null }).error).toBe("incompatible_operands")
		}
		expect(ledger.rows).toHaveLength(9)
	})

	test("ratio of 1.00 / 3.00 stores 1/3 and chains exactly through expr", () => {
		const ledger = ledgerOf([measured("F5", "1.00", EOK_WON, { population: "all" }), measured("F6", "3.00", EOK_WON, { population: "all" })])
		// unit-rules.md: the result unit is always declared; a same-unit ratio is dimensionless (null).
		const ratio = rowOf(derive(ledger, { op: "ratio", num: "F5", den: "F6", unit: null }))
		expect(ratio.exact).toEqual({ num: "1", den: "3" })
		expect(ratio.value).toBe("0.333")
		const chained = rowOf(derive(ledger, { op: "expr", formula: `${ratio.fact_id} * 3`, unit: null }))
		expect(chained.exact).toEqual({ num: "1", den: "1" })
		expect(chained.value).toBe("1")

		const dir = mkdtempSync(join(tmpdir(), "ulw-derive-"))
		onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
		writeLedger(dir, ledger)
		const back = readLedger(dir) as Ledger
		expect(back.rows.find((row) => row.fact_id === ratio.fact_id)?.exact).toEqual({ num: "1", den: "3" })
		expect(recompute(back, back.rows.find((row) => row.fact_id === chained.fact_id) as Row).ok).toBe(true)
	})
})

describe("recompute", () => {
	test("an untouched row recomputes; an edited value or exact does not", () => {
		const ledger = fixture()
		const row = rowOf(derive(ledger, { op: "convert", operands: ["F12"], to: "mm" }))
		expect(recompute(ledger, row)).toMatchObject({ ok: true, expected: { value: "320000", exact: { num: "320000", den: "1" } } })
		expect(recompute(ledger, { ...row, value: "319999" }).ok).toBe(false)
		expect(recompute(ledger, { ...row, exact: { num: "319999", den: "1" } }).ok).toBe(false)
		const sum = rowOf(derive(ledger, { op: "sum", operands: ["F5", "F6"], unit: EOK_WON }))
		expect(recompute(ledger, sum).ok).toBe(true)
		expect(recompute(ledger, { ...sum, exact: { num: "301", den: "1" } }).ok).toBe(false)
	})

	const meters = () => ledgerOf([measured("F1", "1", "m"), measured("F2", "3", "m"), measured("F3", "5", "m")])

	test("a unit relabel with a matching render is refused: 1 m + 3 m relabeled 4 km", () => {
		const ledger = meters()
		const sum = rowOf(derive(ledger, { op: "sum", operands: ["F1", "F2"], unit: "m" }))
		expect(recompute(ledger, sum).ok).toBe(true)
		const relabeled = recompute(ledger, { ...sum, unit: "km", raw: "4 km", render: "4 km" })
		expect(relabeled.ok).toBe(false)
		expect(relabeled.detail).toContain("unit")
		const expr = rowOf(derive(ledger, { op: "expr", formula: "F1 + F2", unit: "m" }))
		expect(recompute(ledger, expr).ok).toBe(true)
		expect(recompute(ledger, { ...expr, unit: "km", raw: "4 km", render: "4 km" }).ok).toBe(false)
	})

	test("a row with null operands is not ok and does not throw", () => {
		const ledger = meters()
		const sum = rowOf(derive(ledger, { op: "sum", operands: ["F1", "F2"], unit: "m" }))
		const result = recompute(ledger, { ...sum, operands: null })
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("operands")
	})

	test("an expr row whose operands no longer match its formula ids is not ok and does not throw", () => {
		const ledger = meters()
		const expr = rowOf(derive(ledger, { op: "expr", formula: "F1 + F2", unit: "m" }))
		const result = recompute(ledger, { ...expr, operands: ["F1", "F3"] })
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("F2")
	})
})
