import { expect, test } from "bun:test"
import { recompute } from "./fact-derive.mjs"
import { derive } from "./tests/derive-clock"
import { addRow, emptyLedger, retractRow, validateLedger } from "./fact-ledger.mjs"
import { canonicalUnit } from "./unit-rules.mjs"
import { convertFactor } from "./units.mjs"
import { Row, Book, now, book, row, sum, refused } from "./tests/fact-unit-dimensions-support"



test("dimension 01: kind operation consistency cannot disable recursive trust", () => {
	for (const patch of [{ operation: null }, { kind: "measured" }, { operation: "convert" }]) {
		const l = book()
		const inner = row(l, sum)
		const outer = row(l, { op: "convert", operands: [inner.fact_id], to: "cm" })
		Object.assign(inner, patch, { value: "999", exact: { num: "999", den: "1" } })
		expect(validateLedger(l).length).toBeGreaterThan(0)
		expect(recompute(l, outer).ok).toBe(false)
		refused(l, { op: "convert", operands: [inner.fact_id], to: "cm" })
	}
})

test("dimension 02: direct and expression metadata propagate with identical compatibility", () => {
	for (const field of ["population", "accounting_basis", "snapshot_window"]) {
		const incompatible = book(["1", "3"], ["m", "m"], [{ [field]: "adults" }, { [field]: "children" }])
		refused(incompatible, sum)
		refused(incompatible, { op: "expr", formula: "F1 + F2", unit: "m" })
	}
	const meta = { population: "all", accounting_basis: "cash", snapshot_window: "2026", entity: "acme", valid_at: "2026" }
	const l = book(["1", "3"], ["m", "m"], [meta, meta])
	for (const spec of [sum, { op: "expr", formula: "F1 + F2", unit: "m" }]) {
		const inner = row(l, spec)
		expect(inner).toMatchObject(meta)
		expect(row(l, { op: "convert", operands: [inner.fact_id], to: "cm" })).toMatchObject(meta)
	}
})

test("dimension 03: precision survives stored intermediates and conversion round trips", () => {
	const l = book(["1.20", "2.30", "0.04"], ["m", "m", "m"])
	const inner = row(l, sum)
	expect(inner.value).toBe("3.5")
	expect(row(l, { ...sum, operands: [inner.fact_id, "F3"] }).value).toBe("3.54")
	const cm = row(l, { op: "convert", operands: [inner.fact_id], to: "cm" })
	const m = row(l, { op: "convert", operands: [cm.fact_id], to: "m" })
	expect(row(l, { ...sum, operands: [m.fact_id, "F3"] }).value).toBe("3.54")
	expect(recompute(l, m).ok).toBe(true)
})

test("dimension 04: scaled aliases preserve composite factor scale", () => {
	for (const [unit, value, formula, expectedUnit, expected] of [
		["bp/person", "100", "F1 * F2", "%p", "1"],
		["person/bp", "1", "F1 / F2", "1/%p", "100"],
		["bp^2/person", "10000", "F1 * F2", "%p^2", "1"],
	] as const) {
		const l = book([value, "1"], [unit, "person"])
		expect(row(l, { op: "expr", formula, unit: expectedUnit }).exact).toEqual({ num: expected, den: "1" })
	}
})

test("dimension 05: public refusal API is total classified and append atomic", () => {
	for (const bad of [null, undefined, 1, [], {}, { op: "wat" }, { ...sum, operands: null }]) {
		const result = refused(book(), bad)
		expect(result).toMatchObject({ shape: expect.any(String), expected: expect.anything() })
	}
	for (const bad of [null, [], {}, { num: "NaN", den: "1" }, { num: "1", den: "0" }]) {
		const l = book()
		l.rows[0].exact = bad
		refused(l, sum)
		const result = recompute(l, l.rows[0])
		expect(result).toMatchObject({ ok: false, shape: expect.any(String) })
		expect(result.expected).toBeDefined()
	}
	for (const bad of [null, undefined, 1, [], {}]) {
		expect(() => recompute(bad, bad)).not.toThrow()
		expect(recompute(bad, bad)).toMatchObject({ ok: false, shape: expect.any(String) })
	}
})

test("dimension 06: aliases normalize at input; derived rows store canonical units, source aliases read canonical (dimension 31)", () => {
	const l = book(["1", "3"], ["metre", "m"])
	expect(l.rows[0].unit).toBe("m")
	const result = row(l, sum)
	l.rows[0].unit = "metre"
	expect(validateLedger(l)).toEqual([])
	expect(recompute(l, result).ok).toBe(true)
	const relabeled = { ...result, unit: "metre" }
	l.rows[l.rows.indexOf(result)] = relabeled
	expect(validateLedger(l).length).toBeGreaterThan(0)
	expect(recompute(l, relabeled).ok).toBe(false)
})

test("dimension 07: exact rationals are reduced canonical integer strings; dev's integer pairs read reduced (dimension 31)", () => {
	for (const [exact, reduced] of [[{ num: "2", den: "2" }, "1"], [{ num: "01", den: "1" }, "1"], [{ num: "-0", den: "1" }, "0"], [{ num: "-6", den: "06" }, "-1"]] as const) {
		const l = book(["1", "3"])
		Object.assign(l.rows[0], { kind: "assumed", rationale: "given", value: reduced, source_id: null, locator: null, snapshot_sha256: null, exact })
		expect(validateLedger(l)).toEqual([])
		expect(row(l, { op: "expr", formula: "F1", unit: "m" }).exact).toEqual({ num: reduced, den: "1" })
	}
	for (const exact of [{ num: 1, den: "1" }, { num: "1", den: "-1" }, { num: "1", den: "0" }, { num: "1.5", den: "1" }]) {
		const l = book()
		Object.assign(l.rows[0], { kind: "assumed", rationale: "given", exact })
		expect(validateLedger(l).length).toBeGreaterThan(0)
		refused(l, { op: "expr", formula: "F1", unit: "m" })
	}
	const l = book()
	const made = row(l, sum)
	made.exact = { num: "8", den: "2" }
	expect(validateLedger(l).length).toBeGreaterThan(0)
	expect(recompute(l, made).ok).toBe(false)
})

test("dimension 08: context schemas reject foreign keys and wrong types", () => {
	const l = book()
	const result = row(l, sum)
	for (const context of [{ disjoint: "true", reference: 7 }, { disjoint: false, reference: null, target: "km" }, { disjoint: false, reference: null, extra: true }]) {
		expect(recompute(l, { ...result, context }).ok).toBe(false)
	}
	refused(l, { ...sum, disjoint: "true" })
	refused(l, { ...sum, target: "km" })
	refused(l, { ...sum, op: "diff", disjoint: true })
	refused(l, { op: "diff", operands: ["F1", "F2"], unit: "m", context: { target: "km" } })
})

test("dimension 09: redundant audit fields are rederived and compared", () => {
	const l = book()
	for (const spec of [sum, { op: "convert", operands: ["F1"], to: "cm" }]) {
		const result = row(l, spec)
		for (const patch of [{ factor: "999" }, { formula: "999" }, { derived_from: ["F2"] }, { raw: "999" }]) {
			expect(recompute(l, { ...result, ...patch }).ok).toBe(false)
		}
	}
})

test("dimension 10: metadata equality ignores object insertion order but not invalid presence", () => {
	const l = book(["1", "3"], ["m", "m"], [{ population: { age: 20, place: "x" } }, { population: { place: "x", age: 20 } }])
	expect(row(l, sum).value).toBe("4")
	for (const value of [undefined, 3, "", []]) {
		const bad = book()
		bad.rows[0].population = value
		refused(bad, sum)
	}
})

test("dimension 11: inactive descendants remain historically verifiable but ineligible", () => {
	const l = book()
	const inner = row(l, sum)
	const outer = row(l, { op: "convert", operands: [inner.fact_id], to: "cm" })
	retractRow(l, "F1", "wrong source")
	expect(recompute(l, outer).ok).toBe(true)
	refused(l, { op: "convert", operands: [outer.fact_id], to: "m" })
})

test("dimension 12: shared DAG nodes are verified once and deep expressions are stack independent", () => {
	const l = book()
	const first = row(l, sum)
	let a = first
	let b = row(l, { ...sum, operands: [first.fact_id, "F1"] })
	for (let i = 0; i < 10; i++) [a, b] = [b, row(l, { ...sum, operands: [a.fact_id, b.fact_id] })]
	let visits = 0
	const exact = first.exact
	Object.defineProperty(first, "exact", { get: () => { visits++; return exact }, configurable: true })
	expect(recompute(l, b).ok).toBe(true)
	expect(visits).toBe(1)
	const deep = `${"(".repeat(12000)}F1${")".repeat(12000)}`
	expect(row(book(), { op: "expr", formula: deep, unit: "m" }).value).toBe("1")
	const chain = book()
	const template = row(chain, { op: "expr", formula: "F1", unit: "m" })
	let previous = String(template.fact_id)
	for (let i = 4; i < 12004; i++) {
		const fact_id = `F${i}`
		chain.rows.push({ ...template, fact_id, label: `chain-${i}`, operands: [previous], derived_from: [previous], formula: previous })
		previous = fact_id
	}
	expect(validateLedger(chain)).toEqual([])
	expect(recompute(chain, chain.rows.at(-1)).ok).toBe(true)
})

test("dimension 13: composite exponents are exact bigint and normalization idempotent", () => {
	for (const [input, expected] of [["m^9007199254740993", "m^9007199254740993"], ["m^9007199254740993/m^9007199254740992", "m"], ["m^0", null], ["m^-2", "1/m^2"], ["m/(s/kg)", "kg*m/s"]] as const) {
		expect(canonicalUnit(input)).toBe(expected)
		expect(canonicalUnit(expected)).toBe(expected)
	}
	for (const input of ["m^1e3", "m^1.5", "m^"]) expect(() => canonicalUnit(input)).toThrow()
})

test("dimension 14: affine and scale atoms cannot hide in composites or cancellation", () => {
	for (const unit of ["C/s", "F*m", "C/C", "(C/s)^2"]) {
		let l: Book
		try { l = book(["1", "3"], [unit, unit]) } catch { continue }
		expect(derive(l, { op: "ratio", num: "F1", den: "F2", unit: null }).error).toBeDefined()
	}
	for (const unit of ["million", "m/M", "bn/bn"]) expect(() => canonicalUnit(unit)).toThrow()
})

test("dimension 15: disjoint shares individually and jointly stay within one whole", () => {
	const spec = { op: "sum", operands: ["F1", "F2"], unit: "%", disjoint: true, reference: "all", rationale: "disjoint" }
	for (const values of [["60", "60"], ["-1", "50"], ["101", "0"]]) refused(book(values, ["%", "%"]), spec)
	expect(row(book(["40", "60"], ["%", "%"]), spec).value).toBe("100")
	refused(book(["20", "30"], ["%", "%"]), { ...spec, reference: { F1: "all", F2: "all", F99: "all" } })
})

test("dimension 16: FX arithmetic persists unchecked compatibility and requires a dated rate", () => {
	const spec = { op: "expr", formula: "F1 * F2", unit: "USD" }
	refused(book(["100", "1.10"], ["EUR", "USD/EUR"]), spec)
	const l = book(["100", "1.10"], ["EUR", "USD/EUR"], [{ valid_at: "2026-10-23" }, { valid_at: "2026-10-23" }])
	const result = row(l, spec)
	expect(result.compatibility).toBe("unchecked")
	expect(result.exact).toEqual({ num: "110", den: "1" })
	expect(recompute(l, result).ok).toBe(true)
	expect(recompute(l, { ...result, compatibility: "checked" }).ok).toBe(false)
})

test("dimension 17: symbols are case sensitive and opaque text stays opaque", () => {
	expect(canonicalUnit("Mb")).toBe("Mb")
	expect(canonicalUnit("MB")).toBe("MB")
	expect(canonicalUnit("m b")).toBe("m b")
	expect(canonicalUnit(" metric ton ")).toBe("metric ton")
	expect(canonicalUnit("m / s")).toBe("m/s")
	expect(canonicalUnit("\u03bcm")).not.toBe(canonicalUnit("\u00b5m"))
})

test("dimension 18: undefined and missing required fields never stand in for null", () => {
	const l = book()
	for (const unit of [undefined, ""]) refused(l, { op: "ratio", num: "F1", den: "F2", unit })
	refused(l, { op: "ratio", num: "F1", den: "F2" })
	expect(row(l, { op: "ratio", num: "F1", den: "F2", unit: null }).unit).toBeNull()
	for (const patch of [{ unit: undefined }, { value: undefined }, { population: undefined }]) {
		const bad = book()
		Object.assign(bad.rows[0], patch)
		refused(bad, sum)
	}
})

test("dimension 19: allocation above safe integer remains exact and unique", () => {
	const l = book()
	l.rows[1].fact_id = "F9007199254740992"
	const result = row(l, { ...sum, operands: ["F1", "F9007199254740992"] })
	expect(result.fact_id).toBe("F9007199254740993")
	expect(recompute(l, result).ok).toBe(true)
})

test("dimension 20: supplied expression operand set must match formula leaves", () => {
	for (const operands of [["F2"], ["F1", "F2"], ["F1", "F1"], [], null]) refused(book(), { op: "expr", formula: "F1", unit: "m", operands })
	expect(row(book(), { op: "expr", formula: "F1 + F2", operands: ["F2", "F1"], unit: "m" }).value).toBe("4")
})
