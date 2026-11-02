import { expect, test } from "bun:test"
import { recompute } from "./fact-derive.mjs"
import { derive } from "./tests/derive-clock"
import { addRow, emptyLedger, retractRow, validateLedger } from "./fact-ledger.mjs"
import { canonicalUnit } from "./unit-rules.mjs"
import { convertFactor } from "./units.mjs"
import { Row, Book, now, book, row, sum, refused } from "./tests/fact-unit-dimensions-support"



test("dimension 21: expression root and literal precision remain explicit", () => {
	const l = book(["1000", "3"], ["m", "m"])
	expect(row(l, { op: "expr", formula: "F1 - F2", unit: "m" }).value).toBe("997")
	expect(row(l, { op: "expr", formula: "(F1 - F2) * 1", unit: "m" }).value).toBe("1000")
	expect(row(l, { op: "expr", formula: "(F1 - F2) * 1.00", unit: "m" }).value).toBe("1000")
})

test("dimension 22: cloned snapshots are deterministic and replay appends a new identity", () => {
	const original = book()
	const left = structuredClone(original)
	const right = structuredClone(original)
	expect(row(left, sum)).toEqual(row(right, sum))
	expect(row(left, sum).fact_id).toBe("F4")
	expect(original.rows).toHaveLength(2)
})

test("dimension 23: coherent trusted input rewrites are a documented arithmetic limitation", () => {
	const l = book(["0", "3"])
	const km = row(l, { op: "convert", operands: ["F1"], to: "km" })
	const cm = row(l, { op: "convert", operands: ["F1"], to: "cm" })
	const coherent = { ...cm, fact_id: km.fact_id, label: km.label }
	expect(recompute(l, coherent).ok).toBe(true)
	expect(recompute(l, { ...km, unit: "cm" }).ok).toBe(false)
})

test("dimension 24: sum permutation and ordered arithmetic keep their own semantics", () => {
	const l = book(["2", "5"])
	for (const operands of [["F1", "F2"], ["F2", "F1"]]) expect(row(l, { ...sum, operands }).exact).toEqual({ num: "7", den: "1" })
	expect(row(l, { ...sum, op: "diff" }).exact).toEqual({ num: "-3", den: "1" })
	expect(row(l, { ...sum, op: "diff", operands: ["F2", "F1"] }).exact).toEqual({ num: "3", den: "1" })
})

test("dimension 25: numeric domain boundaries do not forbid negative ordinary arithmetic", () => {
	for (const values of [["6", "5"], ["-1", "5"], ["0", "0"]]) expect(derive(book(values), { op: "share", part: "F1", whole: "F2", unit: "%" }).error).toBeDefined()
	expect(row(book(["-2", "-5"]), sum).exact).toEqual({ num: "-7", den: "1" })
	expect(derive(book(), { op: "expr", formula: "F1 / (F2 - F2)", unit: null }).error).toBeDefined()
})

test("dimension 26: percent products and pct nodes preserve fraction semantics", () => {
	const l = book(["20", "50"], ["%", "%"])
	expect(row(l, { op: "expr", formula: "pct(F1 * F2)", unit: "%" }).exact).toEqual({ num: "10", den: "1" })
	expect(row(l, { op: "diff", operands: ["F2", "F1"], unit: "%p" }).exact).toEqual({ num: "30", den: "1" })
	expect(derive(l, { op: "expr", formula: "pct(F1)", unit: "%" }).error).toBeDefined()
})

test("dimension 27: conversion maps compose with exact independent rational arithmetic", () => {
	const groups = [["mm", "cm", "m", "km"], ["g", "kg", "t"], ["ms", "s", "min", "h"], ["B", "KB", "MB", "GB", "TB"], ["C", "F"], ["%", "\u2030"], ["KRW", "KRW-e3", "KRW-e4", "KRW-e8", "KRW-e12"]]
	const apply = (factor: { num: bigint; den: bigint; offset?: { num: bigint; den: bigint } } | null, x: [bigint, bigint]): [bigint, bigint] => {
		if (!factor) throw Error("missing conversion")
		const o = factor.offset ?? { num: 0n, den: 1n }
		return [x[0] * factor.num * o.den + o.num * x[1] * factor.den, x[1] * factor.den * o.den]
	}
	for (const group of groups) for (const a of group) for (const b of group) for (const c of group) {
		for (const value of [-3n, 0n, 7n]) {
			const direct = apply(convertFactor(a, c), [value, 1n])
			const chained = apply(convertFactor(b, c), apply(convertFactor(a, b), [value, 1n]))
			expect(direct[0] * chained[1]).toBe(chained[0] * direct[1])
		}
	}
	expect(derive(book(), { op: "convert", operands: ["F1"], to: "furlong" }).error).toBeDefined()
})

test("dimension 28: grammar rejects injection and preserves precedence", () => {
	for (const formula of ["F1;globalThis.x=1", "-F1", "F1 ** 2", "pct F1", "(F1", "F1 F2"]) expect(derive(book(), { op: "expr", formula, unit: "m" }).error).toBeDefined()
	expect(row(book(), { op: "expr", formula: "F1 + F2 * 2", unit: "m" }).exact).toEqual({ num: "7", den: "1" })
})

test("dimension 29: signed rounding ties and canonical display are exact", () => {
	for (const [values, expected] of [[["-1.25", "-2.5"], "-3.8"], [["1.25", "2.5"], "3.8"], [["999.5", "0"], "1000"]] as const) {
		expect(row(book([...values]), sum).value).toBe(expected)
	}
	const l = book(["20", "15"], ["%", "%"])
	const delta = row(l, { op: "diff", operands: ["F1", "F2"], unit: "%p" })
	expect(recompute(l, { ...delta, render: "5 pp" }).ok).toBe(false)
})

test("dimension 30: seeded factor trees have an independent arithmetic and unit oracle", () => {
	let seed = 0x11009
	const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
	const atoms = ["m", "s", "person"]
	for (let i = 0; i < 100; i++) {
		const counts = [0, 0, 0]
		const factors = Array.from({ length: 5 }, () => {
			const index = next() % atoms.length
			const exponent = (next() % 7) - 3
			counts[index] += exponent
			return `(${atoms[index]}^${exponent})`
		})
		const side = (positive: boolean) => atoms.map((a, index) => ({ a, n: counts[index] })).filter(({ n }) => positive ? n > 0 : n < 0).sort((a, b) => a.a.localeCompare(b.a)).map(({ a, n }) => Math.abs(n) === 1 ? a : `${a}^${Math.abs(n)}`)
		const top = side(true).join("*") || "1"
		const bottom = side(false)
		const expectedUnit = bottom.length ? `${top}/${bottom.length === 1 ? bottom[0] : `(${bottom.join("*")})`}` : top === "1" ? null : top
		expect(canonicalUnit(factors.join("*"))).toBe(expectedUnit)
		const a = BigInt(1 + next() % 100)
		const b = BigInt(1 + next() % 100)
		const l = book([String(a), String(b)], [factors.join("*"), "person"])
		const result = row(l, { op: "expr", formula: "F1 * F2 / F2", unit: expectedUnit })
		expect(result.exact).toEqual({ num: String(a), den: "1" })
		expect(result.unit).toBe(expectedUnit)
		expect(recompute(l, result).ok).toBe(true)
		expect(recompute(l, { ...result, exact: { num: String(a + 1n), den: "1" } }).ok).toBe(false)
	}
})

test("dimension 30: independent rational oracle crosses every operation with metadata and tampering", () => {
	let state = 3917
	const next = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state }
	const exact = (n: bigint, d = 1n) => {
		let a = n < 0n ? -n : n
		let b = d
		while (b) [a, b] = [b, a % b]
		return { num: String(n / a), den: String(d / a) }
	}
	for (let i = 0; i < 50; i++) {
		const a = BigInt(1 + next() % 50)
		const b = a + BigInt(1 + next() % 50)
		const meta = { population: { country: "x", cohort: i }, accounting_basis: "cash", snapshot_window: "2026", entity: "acme" }
		const specs: Array<[Row, { num: string; den: string }]> = [
			[{ ...sum }, exact(a + b)],
			[{ ...sum, op: "diff" }, exact(a - b)],
			[{ op: "ratio", num: "F1", den: "F2", unit: null }, exact(a, b)],
			[{ op: "share", part: "F1", whole: "F2", unit: "%" }, exact(100n * a, b)],
			[{ op: "growth", from: "F1", to: "F2", unit: "%" }, exact(100n * (b - a), a)],
			[{ op: "convert", operands: ["F1"], to: "cm" }, exact(100n * a)],
			[{ op: "expr", formula: "F1 * 2 / F2", unit: null }, exact(2n * a, b)],
		]
		for (const [spec, expected] of specs) {
			const l = book([String(a), String(b)], ["metre", "m"], [{ ...meta, valid_at: "2025" }, { ...meta, valid_at: "2026" }])
			const result = row(l, spec)
			expect(result.exact).toEqual(expected)
			expect(recompute(l, result).ok).toBe(true)
			expect(recompute(l, { ...result, unit: "person" }).ok).toBe(false)
			expect(recompute(l, { ...result, exact: { num: String(BigInt(expected.num) + 1n), den: expected.den } }).ok).toBe(false)
		}
		const l = book([String(100n * a), String(b)], ["bp/person", "person"])
		const result = row(l, { op: "expr", formula: "F1 * F2", unit: "%p" })
		expect(result.exact).toEqual(exact(a * b))
	}
})
