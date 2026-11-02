import { describe, expect, test } from "bun:test"
import { display, recompute } from "../fact-derive.mjs"
import { derive } from "./derive-clock"
import { parseExpr } from "../fact-expr.mjs"
import { addRow, emptyLedger, OPERATIONS } from "../fact-ledger.mjs"
import { canonicalUnit, expectedUnit, isAffine, OPERATION_RULES, renderPrecision } from "../unit-rules.mjs"

// Property checks of references/unit-rules.md: every case table below is keyed by the registry's own operation list,
// so a new operation without valid, relabel, and malformed cases fails here.

type Row = Record<string, unknown>

type Ledger = { schemaVersion: number; rows: Row[]; events: unknown[] }

type Spec = Record<string, unknown>

const HASH = "a".repeat(64)

function measured(factId: string, value: string, unit: string | null, extra: Row = {}): Row {
	return {
		fact_id: factId,
		kind: "measured",
		value,
		unit,
		raw: `${value} ${unit ?? ""}`.trim(),
		quote: `The figure is ${value}.`,
		source_id: "S1",
		locator: { artifact: "sources/S1/text.txt", char_start: 0, char_end: 20 },
		snapshot_sha256: HASH,
		extracted_by: "fact add --find",
		observed_at: "2026-10-23T08:00:00Z",
		label: factId.toLowerCase(),
		...extra,
	}
}

function ledger(): Ledger {
	const built = emptyLedger() as Ledger
	const rows = [
		measured("F1", "1", "m"),
		measured("F2", "3", "m"),
		measured("F3", "20", "%"),
		measured("F4", "15", "%"),
		measured("F5", "5", "%p"),
		measured("F6", "100", "case", { valid_at: "2025", entity: "acme" }),
		measured("F7", "112", "case", { valid_at: "2026", entity: "acme" }),
		measured("F8", "40", "person"),
		measured("F9", "200", "person"),
		measured("F10", "100", "USD"),
		measured("F11", "20", "USD/person"),
		measured("F12", "0", "m"),
		measured("F13", "25", "C", { valid_at: "2025", entity: "x" }),
		measured("F14", "30", "C", { valid_at: "2026", entity: "x" }),
		measured("F15", "0", "person"),
		measured("F16", "2.5", "kilometre"),
		measured("F17", "120", "case", { valid_at: "2026", entity: "other" }),
		measured("F18", "0", "case", { valid_at: "2025", entity: "acme" }),
		measured("F19", "-5", "person"),
		measured("F20", "2", "%p"),
		measured("F21", "105", "case", { valid_at: "2025", entity: "acme" }),
		measured("F22", "200", "person"),
	]
	for (const row of rows) addRow(built, row)
	return built
}

const PCT_SUM = { op: "sum", operands: ["F3", "F4"], unit: "%", disjoint: true, reference: "all respondents", rationale: "disjoint answer shares" }

const VALID: Record<string, Array<{ spec: Spec; unit: string | null; precision?: "places" | "sigfigs" }>> = {
	sum: [
		{ spec: { op: "sum", operands: ["F1", "F2"], unit: "m" }, unit: "m" },
		{ spec: { op: "sum", operands: ["F1", "F2"], unit: "metre" }, unit: "m" },
		{ spec: PCT_SUM, unit: "%" },
	],
	diff: [
		{ spec: { op: "diff", operands: ["F2", "F1"], unit: "m" }, unit: "m" },
		{ spec: { op: "diff", operands: ["F3", "F4"], unit: "pp" }, unit: "%p" },
		{ spec: { op: "diff", operands: ["F3", "F5"], unit: "%" }, unit: "%" },
		{ spec: { op: "diff", operands: ["F5", "F20"], unit: "%p" }, unit: "%p" },
	],
	growth: [{ spec: { op: "growth", from: "F6", to: "F7", unit: "%" }, unit: "%" }],
	share: [
		{ spec: { op: "share", part: "F8", whole: "F9", unit: "%" }, unit: "%" },
		{ spec: { op: "share", part: "F22", whole: "F9", unit: "%" }, unit: "%" },
	],
	ratio: [
		{ spec: { op: "ratio", num: "F10", den: "F11", unit: "person" }, unit: "person" },
		{ spec: { op: "ratio", num: "F1", den: "F2", unit: null }, unit: null },
		{ spec: { op: "ratio", num: "F10", den: "F9", unit: "USD/person" }, unit: "USD/person" },
	],
	convert: [
		{ spec: { op: "convert", operands: ["F12"], to: "km" }, unit: "km" },
		{ spec: { op: "convert", operands: ["F16"], to: "m" }, unit: "m" },
		{ spec: { op: "convert", operands: ["F2"], to: "kilometre" }, unit: "km" },
	],
	expr: [
		{ spec: { op: "expr", formula: "F3 - F4", unit: "%p" }, unit: "%p", precision: "places" },
		{ spec: { op: "expr", formula: "F2 - F1", unit: "m" }, unit: "m", precision: "places" },
		{ spec: { op: "expr", formula: "F5", unit: "%p" }, unit: "%p", precision: "places" },
		{ spec: { op: "expr", formula: "F1 * F1 / F2", unit: "m" }, unit: "m" },
		{ spec: { op: "expr", formula: "F10 / F11", unit: "person" }, unit: "person" },
		{ spec: { op: "expr", formula: "pct(F8 / F9)", unit: "%" }, unit: "%" },
		{ spec: { op: "expr", formula: "F3 * F9", unit: "person" }, unit: "person" },
	],
}

/** Invariant 5 per operation: sum and diff render by decimal places, the rest by significant figures (expr cases override). */
const PRECISION: Record<string, "places" | "sigfigs"> = { sum: "places", diff: "places", growth: "sigfigs", share: "sigfigs", ratio: "sigfigs", convert: "sigfigs", expr: "sigfigs" }

const RELABELS = [null, "%", "%p", "pp", "bp", "m", "metre", "km", "kilometre", "cm", "C", "case", "person", "USD", "USD/person", "person/USD", "KRW-e8"]

type Mutation = { name: string; base: Spec; mutate: (row: Row, book: Ledger) => Row; reason: string }

const generic = (base: Spec, arity: string[], arityReason = "takes ", missingReason = "no ledger row F999"): Mutation[] => [
	{ name: "operands null", base, mutate: (row) => ({ ...row, operands: null }), reason: "operands must be a non-empty array" },
	{ name: "operands empty", base, mutate: (row) => ({ ...row, operands: [] }), reason: "operands must be a non-empty array" },
	{ name: "wrong arity", base, mutate: (row) => ({ ...row, operands: arity }), reason: arityReason },
	{ name: "missing operand id", base, mutate: (row) => ({ ...row, operands: (row.operands as string[]).map((id, index) => (index === 0 ? "F999" : id)) }), reason: missingReason },
	{ name: "invalid rational", base, mutate: (row) => ({ ...row, exact: { num: "x", den: "1" } }), reason: "exact must be { num, den }" },
	{ name: "no operation", base, mutate: (row) => ({ ...row, operation: "mean" }), reason: 'operation "mean" is not one of' },
	{ name: "repeated operand", base, mutate: (row) => ({ ...row, operands: repeatFirst(row.operands as string[]) }), reason: "is repeated" },
	{ name: "self reference", base, mutate: (row) => ({ ...row, operands: (row.operands as string[]).map((id, index) => (index === 0 ? row.fact_id : id)) }), reason: "cites itself" },
	{ name: "kind operation", base, mutate: (row) => ({ ...row, kind: "assumed" }), reason: "kind assumed" },
	{ name: "audit fields", base, mutate: (row) => ({ ...row, factor: "999" }), reason: "factor" },
	{ name: "precision field", base, mutate: (row) => ({ ...row, precision: { places: -1, sigfigs: 0 } }), reason: "precision" },
	{ name: "compatibility field", base, mutate: (row) => ({ ...row, compatibility: "invalid" }), reason: "compatibility" },
	{ name: "metadata fields", base, mutate: (row) => ({ ...row, population: { tampered: true } }), reason: "population" },
	{ name: "noncanonical operand", base, mutate: (row, book) => {
		const operand = book.rows.find((r) => r.fact_id === (row.operands as string[])[0])
		if (!operand) throw Error("fixture operand missing")
		operand.unit = `${operand.unit}*bp/%p`
		return row
	}, reason: "canonical" },
]

/** The first operand id in a second slot: [F1, F2] -> [F1, F1]; a one-operand row gets [F1, F1]. */
const repeatFirst = (ids: string[]) => (ids.length === 1 ? [ids[0], ids[0]] : [...ids.slice(0, -1), ids[0]])

const operands = (ids: string[]) => (row: Row) => ({ ...row, operands: ids })

const MALFORMED: Record<string, Mutation[]> = {
	sum: [
		...generic(VALID.sum[0].spec, ["F1"]),
		{ name: "no context", base: VALID.sum[0].spec, mutate: (row) => ({ ...row, context: null }), reason: "sum rows carry a context object" },
		{ name: "% without disjoint", base: PCT_SUM, mutate: (row) => ({ ...row, context: { disjoint: false, reference: "all respondents" } }), reason: "needs disjoint shares" },
		{ name: "% without reference", base: PCT_SUM, mutate: (row) => ({ ...row, context: { disjoint: true, reference: null } }), reason: "one shared reference" },
		{ name: "% without rationale", base: PCT_SUM, mutate: (row) => ({ ...row, rationale: null }), reason: "needs a rationale" },
		{ name: "unequal units", base: VALID.sum[0].spec, mutate: operands(["F1", "F8"]), reason: "unit differs" },
		{ name: "affine units", base: VALID.sum[0].spec, mutate: operands(["F13", "F14"]), reason: "sum refuses affine" },
		{ name: "closed context", base: VALID.sum[0].spec, mutate: (row) => ({ ...row, context: { disjoint: "true", reference: 7, extra: true } }), reason: "sum context" },
		{ name: "share total", base: PCT_SUM, mutate: (row, book) => {
			for (const operand of book.rows.filter((r) => ["F3", "F4"].includes(String(r.fact_id)))) Object.assign(operand, { value: "60", exact: { num: "60", den: "1" } })
			return row
		}, reason: "total <= 100" },
	],
	diff: [
		...generic(VALID.diff[0].spec, ["F2", "F1", "F8"]),
		{ name: "%p - % pair", base: VALID.diff[2].spec, mutate: operands(["F5", "F3"]), reason: '"%p" - "%" is not a typed pair' },
		{ name: "unit - other unit pair", base: VALID.diff[0].spec, mutate: operands(["F1", "F8"]), reason: '"m" - "person" is not a typed pair' },
		{ name: "affine units", base: VALID.diff[0].spec, mutate: operands(["F14", "F13"]), reason: "affine (temperature)" },
		{ name: "stray context", base: VALID.diff[0].spec, mutate: (row) => ({ ...row, context: "x" }), reason: "diff rows carry no context" },
	],
	growth: [
		...generic(VALID.growth[0].spec, ["F6"]),
		{ name: "affine units", base: VALID.growth[0].spec, mutate: operands(["F13", "F14"]), reason: "growth refuses affine" },
		{ name: "unequal units", base: VALID.growth[0].spec, mutate: operands(["F6", "F8"]), reason: "unit differs" },
		{ name: "entity mismatch", base: VALID.growth[0].spec, mutate: operands(["F6", "F17"]), reason: "growth needs one declared entity" },
		{ name: "one period", base: VALID.growth[0].spec, mutate: operands(["F6", "F21"]), reason: "two different valid_at periods" },
		{ name: "from <= 0", base: VALID.growth[0].spec, mutate: operands(["F18", "F7"]), reason: "positive starting value in F18" },
		{ name: "stray context", base: VALID.growth[0].spec, mutate: (row) => ({ ...row, context: { target: "km" } }), reason: "growth rows carry no context" },
	],
	share: [
		...generic(VALID.share[0].spec, ["F8"]),
		{ name: "affine units", base: VALID.share[0].spec, mutate: operands(["F13", "F14"]), reason: "share refuses affine" },
		{ name: "unequal units", base: VALID.share[0].spec, mutate: operands(["F8", "F1"]), reason: "unit differs" },
		{ name: "whole <= 0", base: VALID.share[0].spec, mutate: operands(["F8", "F15"]), reason: "positive whole in F15" },
		{ name: "part < 0", base: VALID.share[0].spec, mutate: operands(["F19", "F9"]), reason: "F19 is outside [0, F9]" },
		{ name: "part above whole", base: VALID.share[0].spec, mutate: operands(["F9", "F8"]), reason: "F9 is outside [0, F8]" },
		{ name: "stray context", base: VALID.share[0].spec, mutate: (row) => ({ ...row, context: "x" }), reason: "share rows carry no context" },
	],
	ratio: [
		...generic(VALID.ratio[0].spec, ["F10"]),
		{ name: "affine units", base: VALID.ratio[0].spec, mutate: operands(["F13", "F14"]), reason: "ratio refuses affine" },
		{ name: "divides by zero", base: VALID.ratio[0].spec, mutate: operands(["F10", "F15"]), reason: "denominator F15 is zero" },
		{ name: "stray context", base: VALID.ratio[0].spec, mutate: (row) => ({ ...row, context: { target: "km" } }), reason: "ratio rows carry no context" },
	],
	convert: [
		...generic(VALID.convert[0].spec, ["F12", "F1"]),
		{ name: "no context", base: VALID.convert[0].spec, mutate: (row) => ({ ...row, context: null }), reason: "convert rows carry a context object" },
		{ name: "empty target", base: VALID.convert[0].spec, mutate: (row) => ({ ...row, context: { target: "" } }), reason: "carries its target in context.target" },
		{ name: "alias target", base: VALID.convert[0].spec, mutate: (row) => ({ ...relabel(row, "kilometre")[0], context: { target: "kilometre" } }), reason: 'context.target "kilometre" is not canonical' },
		{ name: "currency target", base: VALID.convert[0].spec, mutate: (row) => ({ ...row, context: { target: "USD" } }), reason: "no table conversion to USD (a currency)" },
		{ name: "no factor to target", base: VALID.convert[0].spec, mutate: (row) => ({ ...row, context: { target: "person" } }), reason: 'F12 in "m" has no table conversion to person' },
		{ name: "closed context", base: VALID.convert[0].spec, mutate: (row) => ({ ...row, context: { target: "km", extra: true } }), reason: "exactly target" },
	],
	expr: [
		...generic(VALID.expr[0].spec, ["F3", "F4", "F5"], "do not match operands", "do not match operands F999, F4"),
		{ name: "formula id mismatch", base: VALID.expr[0].spec, mutate: (row) => ({ ...row, formula: "F3 - F99" }), reason: "do not match operands" },
		{ name: "parse error", base: VALID.expr[0].spec, mutate: (row) => ({ ...row, formula: "F3 -" }), reason: "the expression ends early" },
		{ name: "divides by zero", base: VALID.expr[0].spec, mutate: (row) => ({ ...row, formula: "F3 / (F4 - F4)" }), reason: "the expression divides by zero" },
		{ name: "uninferable unit", base: VALID.expr[0].spec, mutate: (row) => ({ ...row, formula: "F3 + F4" }), reason: "adding % values" },
		{ name: "affine sum", base: VALID.expr[0].spec, mutate: (row) => ({ ...row, formula: "F13 + F14", operands: ["F13", "F14"] }), reason: "adding affine (temperature)" },
		{ name: "stray context", base: VALID.expr[0].spec, mutate: (row) => ({ ...row, context: { target: "km" } }), reason: "expr rows carry no context" },
		{ name: "undated rate", base: VALID.expr[0].spec, mutate: (row, book) => {
			const rate = book.rows.find((r) => r.fact_id === "F3")
			if (!rate) throw Error("fixture rate missing")
			rate.unit = "USD/EUR"
			return { ...row, formula: "F3 * F4" }
		}, reason: "dated valid_at" },
	],
}

/** Review r6 HIGH: one id twice is never disjoint shares; expr repeats F1 inside its formula and stores the id set. */
const REPEATED: Record<string, Spec> = {
	sum: { ...PCT_SUM, operands: ["F3", "F3"] },
	diff: { op: "diff", operands: ["F3", "F3"], unit: "%p" },
	growth: { op: "growth", from: "F6", to: "F6", unit: "%" },
	share: { op: "share", part: "F9", whole: "F9", unit: "%" },
	ratio: { op: "ratio", num: "F10", den: "F10", unit: null },
	convert: { op: "convert", operands: ["F12", "F12"], to: "km" },
	expr: { op: "expr", formula: "F1 * F1 / F2", unit: "m" },
}

function rowOf(result: { row?: Row; error?: string; detail?: string }): Row {
	if (!result.row) throw new Error(`expected a row, got ${result.error}: ${result.detail}`)
	return result.row
}

/** The row relabeled to `unit`; when the operation persists a context, a second variant rewrites that context too. */
function relabel(row: Row, unit: string | null): Row[] {
	const shown = display(row.value, unit)
	const render = row.operation === "convert" ? `${shown} ${String(row.render).slice(String(row.render).indexOf("("))}` : shown
	const plain = { ...row, unit, raw: render, render }
	const context = row.context as Row
	if (row.operation === "convert") return [plain, { ...plain, context: { ...context, target: unit } }]
	if (row.operation === "sum") return [plain, { ...plain, context: { ...context, reference: `relabeled ${unit}` } }]
	return [plain]
}

const OPS = Object.keys(OPERATION_RULES)
export { Row, Ledger, Spec, HASH, measured, ledger, PCT_SUM, VALID, PRECISION, RELABELS, Mutation, generic, repeatFirst, operands, MALFORMED, REPEATED, rowOf, relabel, OPS }
