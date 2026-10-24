// fact-ledger-kinds.mjs - the per-kind column rules of the fact ledger as one table, KIND_RULES.
// validateLedger checks every per-kind column through kindRuleErrors, the writers read their
// per-kind choices (id prefix, measured exact) from it, and the per-kind table in
// references/fact-ledger-grammar.md is rendered from it (`node fact-ledger-kinds.mjs --render-grammar`).
// Also the value primitives the schema shares. Pure functions with no IO; node: builtins only.

import { isCliEntry } from "./entry-guard.mjs"

export const DECIMAL = /^-?\d+(?:\.\d+)?$/
const INTEGER = /^-?\d+$/
const SHA256 = /^[0-9a-f]{64}$/
const SOURCE_ID = /^S\d+$/

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
export const isString = (value) => typeof value === "string"
export const isNonEmpty = (value) => typeof value === "string" && value.length > 0
export const isCount = (value) => Number.isInteger(value) && value >= 0
const isDecimal = (value) => isString(value) && DECIMAL.test(value)
const isRational = (exact) => isObject(exact) && isString(exact.num) && isString(exact.den) && INTEGER.test(exact.num) && /^\d+$/.test(exact.den) && !/^0+$/.test(exact.den)

/** The exact rational of a decimal string, reduced. */
export function exactFromDecimal(value) {
	const [whole, fraction = ""] = value.replace(/^-/, "").split(".")
	let num = BigInt(whole + fraction)
	let den = 10n ** BigInt(fraction.length)
	let a = num
	let b = den
	while (b !== 0n) [a, b] = [b, a % b]
	if (a > 1n) [num, den] = [num / a, den / a]
	return { num: `${value.startsWith("-") && num !== 0n ? "-" : ""}${num}`, den: `${den}` }
}

/** @returns {string[]} what is wrong with a locator object, each message prefixed with `at`. */
export function locatorErrors(locator, at) {
	const errors = []
	if (!isObject(locator)) return errors
	if (!isNonEmpty(locator.artifact)) errors.push(`${at}.artifact must be a non-empty string`)
	if (!(isCount(locator.char_start) && isCount(locator.char_end) && locator.char_start <= locator.char_end)) errors.push(`${at}.char_start/char_end must be integers with start <= end`)
	for (const key of ["page", "line"]) {
		if (locator[key] !== undefined && !(Number.isInteger(locator[key]) && locator[key] >= 1)) errors.push(`${at}.${key} must be an integer >= 1`)
	}
	for (const key of ["table", "row_label", "col_label"]) {
		if (locator[key] !== undefined && !isString(locator[key])) errors.push(`${at}.${key} must be a string`)
	}
	return errors
}

const isLocator = (value) => isObject(value) && locatorErrors(value, "").length === 0
const orNull = (test) => (value, row) => value === null || test(value, row)
const locatorDetail = (value, at) => locatorErrors(value, at)

/**
 * Every rule a KIND_RULES cell may name: `cell` is its text in the grammar table, `says` ends the
 * error message, `test(value, row)` decides it, and `prefix` (id rules only) is what nextId uses.
 */
export const RULES = Object.freeze({
	f_id: { cell: "`F<n>`", says: "F<n>", prefix: "F", test: (v) => isString(v) && /^F\d+$/.test(v) },
	q_id: { cell: "`Q<n>`", says: "Q<n>", prefix: "Q", test: (v) => isString(v) && /^Q\d+$/.test(v) },
	decimal: { cell: "decimal", says: "a decimal string", test: isDecimal },
	null: { cell: "null", says: "null", test: (v) => v === null },
	source: { cell: "`S<n>`", says: "S<n>", test: (v) => isString(v) && SOURCE_ID.test(v) },
	source_or_null: { cell: "`S<n>` or null", says: "S<n> or null", test: orNull((v) => isString(v) && SOURCE_ID.test(v)) },
	locator: { cell: "object", says: "a locator object", test: isLocator, detail: locatorDetail },
	locator_or_null: { cell: "object or null", says: "a locator object or null", test: orNull(isLocator), detail: locatorDetail },
	sha256: { cell: "sha256", says: "a sha256 hex digest", test: (v) => isString(v) && SHA256.test(v) },
	sha256_or_null: { cell: "sha256 or null", says: "a sha256 hex digest or null", test: orNull((v) => isString(v) && SHA256.test(v)) },
	string_or_null: { cell: "string or null", says: "null or a string", test: orNull(isString) },
	non_empty: { cell: "non-empty", says: "a non-empty string (required for this kind)", test: isNonEmpty },
	from_value: {
		cell: "from `value`",
		says: "the reduced exact rational of value",
		test: (v, row) => isRational(v) && (!isDecimal(row.value) || (v.num === exactFromDecimal(row.value).num && v.den === exactFromDecimal(row.value).den)),
	},
	rational_or_null: { cell: "rational or null", says: "null or { num: integer string, den: positive integer string }", test: orNull(isRational) },
	by_derive: { cell: "written by derive (rational or null)", says: "null or { num: integer string, den: positive integer string }", test: orNull(isRational) },
})

/** The grammar's per-kind columns, in table order; `exact` follows `value` because it reads it. */
export const KIND_COLUMNS = Object.freeze(["fact_id", "value", "source_id", "locator", "snapshot_sha256", "rationale", "exact"])

const sourced = { source_id: "source", locator: "locator", snapshot_sha256: "sha256" }
const unsourced = { source_id: "source_or_null", locator: "locator_or_null", snapshot_sha256: "sha256_or_null" }
const row = (cells) => Object.freeze(Object.fromEntries(KIND_COLUMNS.map((column) => [column, cells[column]])))

export const KIND_RULES = Object.freeze({
	measured: row({ fact_id: "f_id", value: "decimal", ...sourced, rationale: "string_or_null", exact: "from_value" }),
	quote: row({ fact_id: "q_id", value: "null", ...sourced, rationale: "string_or_null", exact: "null" }),
	derived: row({ fact_id: "f_id", value: "decimal", ...unsourced, rationale: "string_or_null", exact: "by_derive" }),
	assumed: row({ fact_id: "f_id", value: "decimal", ...unsourced, rationale: "non_empty", exact: "rational_or_null" }),
	converted: row({ fact_id: "f_id", value: "decimal", ...unsourced, rationale: "string_or_null", exact: "by_derive" }),
})

/** The id prefix nextId assigns for a kind; an unknown kind gets F and fails validation later. */
export function idPrefix(kind) {
	return RULES[KIND_RULES[kind]?.fact_id ?? "f_id"].prefix
}

/** Whether addRow computes the row's exact from its decimal value. */
export function exactComesFromValue(kind) {
	return KIND_RULES[kind]?.exact === "from_value"
}

/** @returns {string[]} every per-kind column error of one row; empty for an unknown kind. */
export function kindRuleErrors(candidate, at) {
	const rules = KIND_RULES[candidate.kind]
	if (rules === undefined) return []
	const errors = []
	for (const column of KIND_COLUMNS) {
		const value = candidate[column]
		if (value === undefined) continue
		const rule = RULES[rules[column]]
		if (rule.test(value, candidate)) continue
		errors.push(`${at}.${column} must be ${rule.says} for a ${candidate.kind} row`)
		if (rule.detail) errors.push(...rule.detail(value, `${at}.${column}`))
	}
	return errors
}

export const KIND_TABLE_BEGIN = "<!-- kind-rules:begin (rendered from KIND_RULES; do not edit by hand) -->"
export const KIND_TABLE_END = "<!-- kind-rules:end -->"

/** The grammar's per-kind Markdown table, one line per column, ending in a newline. */
export function renderKindTable() {
	const kinds = Object.keys(KIND_RULES)
	const lines = [`| field | ${kinds.join(" | ")} |`, `|${"---|".repeat(kinds.length + 1)}`]
	for (const column of KIND_COLUMNS) lines.push(`| \`${column}\` | ${kinds.map((kind) => RULES[KIND_RULES[kind][column]].cell).join(" | ")} |`)
	return `${lines.join("\n")}\n`
}

if (isCliEntry(import.meta.url)) {
	if (process.argv[2] === "--render-grammar" && process.argv.length === 3) process.stdout.write(renderKindTable())
	else {
		process.stderr.write("usage: node fact-ledger-kinds.mjs --render-grammar\n")
		process.exitCode = 2
	}
}
