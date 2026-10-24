import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { KIND_COLUMNS, KIND_RULES as RULES_TABLE, KIND_TABLE_BEGIN, KIND_TABLE_END, exactFromDecimal, renderKindTable } from "./fact-ledger-kinds.mjs"
import { FACT_KINDS, LEDGER_SCHEMA_VERSION, ROW_DEFAULTS, validateLedger } from "./fact-ledger-schema.mjs"

// Property tests generated from KIND_RULES: for every kind, rows built from each column's rule
// validate, and breaking exactly one column's rule is rejected with an error naming that column.

/** mulberry32: a fixed seed gives the same rows on every run. */
function prng(seed: number) {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const KIND_RULES = RULES_TABLE as Record<string, Record<string, string>>

type Random = () => number
const int = (random: Random, max: number) => Math.floor(random() * max)
const pick = <T>(random: Random, list: T[]): T => list[int(random, list.length)]

function decimal(random: Random) {
	const whole = `${pick(random, ["-", ""])}${int(random, 5000)}`
	return random() < 0.5 ? whole : `${whole}.${String(int(random, 1000)).padStart(pick(random, [1, 2, 3]), "0").slice(0, 3)}`
}
const rational = (random: Random) => exactFromDecimal(decimal(random))
const locator = (random: Random) => ({ artifact: `sources/S${1 + int(random, 9)}/text.txt`, char_start: 3, char_end: 3 + int(random, 80) })
const sha = (random: Random) => Array.from({ length: 64 }, () => "0123456789abcdef"[int(random, 16)]).join("")

type Row = Record<string, unknown> & { value: string }
type Gen = { valid: (random: Random, row: Row) => unknown; invalid: (random: Random, row: Row) => unknown }

/** One valid and one invalid generator per rule name; an unknown rule name fails the test below. */
const GENERATORS: Record<string, Gen> = {
	f_id: { valid: (r) => `F${1 + int(r, 99)}`, invalid: (r) => `Q${1 + int(r, 99)}` },
	q_id: { valid: (r) => `Q${1 + int(r, 99)}`, invalid: (r) => `F${1 + int(r, 99)}` },
	decimal: { valid: decimal, invalid: (r) => pick(r, ["1e3", "", null, 12, "1,000"]) },
	null: { valid: () => null, invalid: (r) => pick(r, ["0", { num: "1", den: "1" }, "S1", "why"]) },
	source: { valid: (r) => `S${1 + int(r, 9)}`, invalid: (r) => pick(r, [null, "F1", "S"]) },
	source_or_null: { valid: (r) => pick(r, [null, `S${1 + int(r, 9)}`]), invalid: (r) => pick(r, ["F1", "S", 3]) },
	locator: { valid: locator, invalid: (r) => pick(r, [null, { artifact: "", char_start: 0, char_end: 1 }, { artifact: "a", char_start: 5, char_end: 1 }]) },
	locator_or_null: { valid: (r) => pick(r, [null, locator(r)]), invalid: (r) => pick(r, ["here", { artifact: "", char_start: 0, char_end: 1 }]) },
	sha256: { valid: sha, invalid: (r) => pick(r, [null, "abc", "A".repeat(64)]) },
	sha256_or_null: { valid: (r) => pick(r, [null, sha(r)]), invalid: (r) => pick(r, ["abc", 7]) },
	string_or_null: { valid: (r) => pick(r, [null, "", "a reason"]), invalid: (r) => pick(r, [5, false, {}]) },
	non_empty: { valid: () => "assumed from the filing year", invalid: (r) => pick(r, ["", null]) },
	from_value: {
		valid: (_r, row) => exactFromDecimal(row.value),
		invalid: (r, row) => {
			const exact = exactFromDecimal(row.value)
			return pick(r, [null, { num: `${BigInt(exact.num) + 7n}`, den: exact.den }, { num: `${BigInt(exact.num) * 2n}`, den: `${BigInt(exact.den) * 2n}` }])
		},
	},
	rational_or_null: { valid: (r) => pick(r, [null, rational(r)]), invalid: (r) => pick(r, [{ num: "1", den: "0" }, { num: 1, den: "2" }, "1/2"]) },
	by_derive: { valid: rational, invalid: (r) => pick(r, [null, { num: "1", den: "0" }, { num: "x", den: "2" }, "1/2"]) },
	context_by_derive: { valid: (_r, row) => row.kind === "converted" ? { target: "km" } : null, invalid: (r) => pick(r, ["km", 3, ["km"], false]) },
	derived_operation: { valid: () => "expr", invalid: (r) => pick(r, [null, "convert", "mean"]) },
	convert_operation: { valid: () => "convert", invalid: (r) => pick(r, [null, "sum", "mean"]) },
	precision: { valid: () => ({ places: 2, sigfigs: 3 }), invalid: (r) => pick(r, [null, { places: -1, sigfigs: 3 }, { places: 2, sigfigs: 0 }]) },
	compatibility: { valid: (_r, row) => row.operation === "expr" ? "unchecked" : "checked", invalid: () => "invalid" },
}

function baseRow(kind: string): Row {
	const row: Record<string, unknown> = { ...structuredClone(ROW_DEFAULTS), kind, raw: "raw", quote: "quoted text", extracted_by: "fact add", observed_at: "2026-10-23T08:00:00Z", label: "x" }
	if (kind === "derived" || kind === "converted") Object.assign(row, { operands: ["F1000"], derived_from: ["F1000"], formula: "F1000", render: "raw" })
	return row as Row
}

/** A row whose every KIND_COLUMNS field follows its kind's rule, in column order (exact after value). */
function validRow(kind: string, random: Random) {
	const row = baseRow(kind)
	for (const column of KIND_COLUMNS) row[column] = GENERATORS[KIND_RULES[kind][column]].valid(random, row)
	return row
}

const ledgerOf = (row: object) => ({ schemaVersion: LEDGER_SCHEMA_VERSION, rows: [row, { ...validRow("measured", prng(42)), fact_id: "F1000", label: "dependency" }], events: [] })
const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1)

describe("KIND_RULES covers the grammar", () => {
	test("every kind has a rule for every column, and every rule has a generator", () => {
		expect(Object.keys(KIND_RULES)).toEqual([...FACT_KINDS])
		for (const kind of FACT_KINDS) {
			expect(Object.keys(KIND_RULES[kind])).toEqual([...KIND_COLUMNS])
			for (const column of KIND_COLUMNS) expect(Object.hasOwn(GENERATORS, KIND_RULES[kind][column])).toBe(true)
		}
	})
})

describe("rows generated from KIND_RULES", () => {
	for (const kind of FACT_KINDS) {
		test(`${kind}: seeded valid rows validate`, () => {
			for (const seed of SEEDS) {
				const row = validRow(kind, prng(seed))
				expect({ seed, errors: validateLedger(ledgerOf(row)) }).toEqual({ seed, errors: [] })
			}
		})

		for (const column of KIND_COLUMNS) {
			test(`${kind}: breaking only the ${column} rule (${KIND_RULES[kind][column]}) is rejected`, () => {
				for (const seed of SEEDS) {
					const random = prng(seed * 7919)
					const row = validRow(kind, random)
					row[column] = GENERATORS[KIND_RULES[kind][column]].invalid(random, row)
					const errors = validateLedger(ledgerOf(row))
					expect({ seed, value: row[column], named: errors.some((error: string) => error.startsWith(`rows[0].${column}`)) }).toEqual({ seed, value: row[column], named: true })
				}
			})
		}
	}

	test("review MEDIUM: a measured row with value -0.50 and exact 7/1 is rejected", () => {
		const row = { ...validRow("measured", prng(1)), value: "-0.50", exact: { num: "7", den: "1" } }
		expect(validateLedger(ledgerOf(row)).some((error: string) => error.startsWith("rows[0].exact"))).toBe(true)
		expect(validateLedger(ledgerOf({ ...row, exact: { num: "-1", den: "2" } }))).toEqual([])
	})

	test("review r6 LOW 3: context is a derived or converted column; a measured, quote, or assumed row carrying one is rejected", () => {
		for (const kind of ["measured", "quote", "assumed"]) {
			const row = { ...validRow(kind, prng(3)), context: { target: "km" } }
			expect({ kind, named: validateLedger(ledgerOf(row)).some((error: string) => error.startsWith("rows[0].context")) }).toEqual({ kind, named: true })
		}
		expect(validateLedger(ledgerOf(validRow("converted", prng(4))))).toEqual([])
		expect(validateLedger(ledgerOf({ ...validRow("derived", prng(4)), context: { target: "km" } })).length).toBeGreaterThan(0)
	})

	test("review LOW 1: a quote row with a non-null exact is rejected", () => {
		const row = { ...validRow("quote", prng(2)), exact: { num: "1", den: "1" } }
		expect(validateLedger(ledgerOf(row)).some((error: string) => error.startsWith("rows[0].exact"))).toBe(true)
	})
})

describe("the grammar's per-kind table is rendered from KIND_RULES", () => {
	const grammar = readFileSync(join(import.meta.dir, "..", "references", "fact-ledger-grammar.md"), "utf8")

	test("the committed table section equals renderKindTable() byte for byte", () => {
		const begin = grammar.indexOf(KIND_TABLE_BEGIN)
		const end = grammar.indexOf(KIND_TABLE_END)
		expect(begin).toBeGreaterThanOrEqual(0)
		expect(end).toBeGreaterThan(begin)
		expect(grammar.slice(begin + KIND_TABLE_BEGIN.length + 1, end)).toBe(renderKindTable())
	})

	test("node fact-ledger-kinds.mjs --render-grammar prints the same table", () => {
		const result = spawnSync("node", [join(import.meta.dir, "fact-ledger-kinds.mjs"), "--render-grammar"], { encoding: "utf8" })
		expect(result.status).toBe(0)
		expect(result.stdout).toBe(renderKindTable())
	})
})
