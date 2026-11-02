// fact-ledger-kinds.mjs - the per-kind column rules of the fact ledger as one table, KIND_RULES.
// validateLedger checks every per-kind column through kindRuleErrors, the writers read their
// per-kind choices (id prefix, measured exact) from it, and the per-kind table in
// references/fact-ledger-grammar.md is rendered from it (`node fact-ledger-kinds.mjs --render-grammar`).
// Also the value primitives the schema shares. Pure functions with no IO; node: builtins only.
import { isCliEntry } from "./entry-guard.mjs"
import { canonicalUnit, inputScale, RuleError } from "./unit-algebra.mjs"
import { metadataErrors } from "./unit-metadata.mjs"
import { mul } from "./rational.mjs"
import { placesOf, roundPlaces, toBig } from "./unit-precision.mjs"
import { OPERATION_RULES } from "./unit-rules.mjs"

export const DECIMAL = /^-?\d+(?:\.\d+)?$/
const INTEGER = /^-?\d+$/
const SHA256 = /^[0-9a-f]{64}$/
const SOURCE_ID = /^S\d+$/
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
export const isString = (value) => typeof value === "string"
export const isNonEmpty = (value) => typeof value === "string" && value.length > 0
export const isCount = (value) => Number.isInteger(value) && value >= 0
const isDecimal = (value) => isString(value) && DECIMAL.test(value)
export function isRational(exact) {
	if (!isObject(exact) || Object.keys(exact).sort().join(",") !== "den,num" || !isString(exact.num) || !isString(exact.den) || !INTEGER.test(exact.num) || !/^[1-9]\d*$/.test(exact.den)) return false
	let a = BigInt(exact.num)
	let b = BigInt(exact.den)
	if (String(a) !== exact.num) return false
	if (a < 0n) a = -a
	while (b !== 0n) [a, b] = [b, a % b]
	return a === 1n
}

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
	if (locator.unit !== undefined && locator.unit !== "bytes") errors.push(`${at}.unit must be bytes`)
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
	by_derive: { cell: "reduced rational", says: "a reduced { num: integer string, den: positive integer string }", test: isRational },
	context_by_derive: { cell: "written by derive (object or null)", says: "null or an object", test: orNull(isObject) },
	source_context: { cell: "quote context or null (legacy)", says: "null or { prefix, suffix } up to 32 characters each", test: orNull((v) => isObject(v) && Object.keys(v).sort().join(",") === "prefix,suffix" && [v.prefix, v.suffix].every((s) => isString(s) && [...s].length <= 32)) },
	derived_operation: { cell: "sum/diff/growth/share/ratio/expr", says: "a derived operation", test: (v) => Object.hasOwn(OPERATION_RULES, v) && OPERATION_RULES[v].kind === "derived" },
	convert_operation: { cell: "`convert`", says: "convert", test: (v) => Object.hasOwn(OPERATION_RULES, v) && OPERATION_RULES[v].kind === "converted" },
	precision: { cell: "`{ places, sigfigs }`", says: "nonnegative places and positive sigfigs", test: (v) => isObject(v) && Object.keys(v).sort().join(",") === "places,sigfigs" && Number.isSafeInteger(v.places) && v.places >= 0 && Number.isSafeInteger(v.sigfigs) && v.sigfigs >= 1 },
	compatibility: { cell: "checked or unchecked (expr)", says: "the operation's compatibility", test: (v, r) => Object.hasOwn(OPERATION_RULES, r.operation) && v === OPERATION_RULES[r.operation].compatibility },
})

/** The grammar's per-kind columns, in table order; `exact` follows `value` because it reads it. */
export const KIND_COLUMNS = Object.freeze(["fact_id", "value", "source_id", "locator", "snapshot_sha256", "rationale", "exact", "context", "operation", "precision", "compatibility"])

const sourced = { source_id: "source", locator: "locator", snapshot_sha256: "sha256" }
const unsourced = { source_id: "source_or_null", locator: "locator_or_null", snapshot_sha256: "sha256_or_null" }
const row = (cells) => Object.freeze(Object.fromEntries(KIND_COLUMNS.map((column) => [column, cells[column] ?? (["precision", "compatibility"].includes(column) && cells.operation !== "null" ? column : "null")])))

export const KIND_RULES = Object.freeze({
	measured: row({ fact_id: "f_id", value: "decimal", ...sourced, rationale: "string_or_null", exact: "from_value", context: "source_context", operation: "null" }),
	quote: row({ fact_id: "q_id", value: "null", ...sourced, rationale: "string_or_null", exact: "null", context: "source_context", operation: "null" }),
	derived: row({ fact_id: "f_id", value: "decimal", ...unsourced, rationale: "string_or_null", exact: "by_derive", context: "context_by_derive", operation: "derived_operation" }),
	assumed: row({ fact_id: "f_id", value: "decimal", ...unsourced, rationale: "non_empty", exact: "rational_or_null", context: "null", operation: "null" }),
	converted: row({ fact_id: "f_id", value: "decimal", ...unsourced, rationale: "string_or_null", exact: "by_derive", context: "context_by_derive", operation: "convert_operation" }),
})

export function idPrefix(kind) {
	return RULES[KIND_RULES[kind]?.fact_id ?? "f_id"].prefix
}

/** Whether addRow computes the row's exact from its decimal value. */
export function exactComesFromValue(kind) {
	return KIND_RULES[kind]?.exact === "from_value"
}

/** Columns added after schema version 1 shipped; a ledger written before them still loads (dimension 31). */
export const LATER_COLUMNS = Object.freeze(["context", "precision", "compatibility"])
const DERIVED_KINDS = Object.freeze(["derived", "converted"])
const PRE_REGISTRY_COLUMNS = KIND_COLUMNS.slice(0, KIND_COLUMNS.indexOf("exact") + 1)

/** A derived or converted row written before the later columns existed: loadable, never an operand. */
export const isLegacyDerived = (row) => isObject(row) && DERIVED_KINDS.includes(row.kind) && LATER_COLUMNS.every((column) => !Object.hasOwn(row, column))
/** A derived or converted row carrying this version's columns: the only rows checked strictly at read time. */
export const isCurrentDerived = (row) => isObject(row) && DERIVED_KINDS.includes(row.kind) && !isLegacyDerived(row)

/** An exact carrying keys beyond num and den: never normalized, never silently stripped, flagged on use. */
export const hasUnknownExactKeys = (exact) => isObject(exact) && isString(exact.num) && isString(exact.den) && Object.keys(exact).sort().join(",") !== "den,num"
/** Any integer pair dev's writer accepted, reduced: sign on num, no leading zeros, gcd 1; anything else as given. */
function readExact(exact) {
	if (!isObject(exact) || hasUnknownExactKeys(exact) || !isString(exact.num) || !isString(exact.den) || !INTEGER.test(exact.num) || !/^\d+$/.test(exact.den) || /^0+$/.test(exact.den)) return exact
	const { num, den } = mul({ num: BigInt(exact.num), den: BigInt(exact.den) }, 1n)
	return { num: String(num), den: String(den) }
}

const readDecimal = (value) => (isDecimal(value) ? value.replace(/^(-?)0+(?=\d)/, "$1") : value)

/** A source unit read through the alias table; unknown, scaled, or unparseable text stays as given. */
export function sourceUnit(unit) {
	try {
		const canonical = canonicalUnit(unit)
		return isString(canonical) && !inputScale(unit) ? canonical : unit
	} catch (error) {
		if (error instanceof RuleError) return unit
		throw error
	}
}

/**
 * A row as every reader sees it (dimension 31 wins at read time): rows not written by derive in this
 * version get reduced exacts and decimals; source rows also get canonical units and null later columns.
 * Current derived rows stay as stored so tampering is still detected. Idempotent.
 */
export function readRow(row) {
	if (!isObject(row) || !Object.hasOwn(KIND_RULES, row.kind) || isCurrentDerived(row)) return row
	const read = { ...row, value: readDecimal(row.value), exact: exactComesFromValue(row.kind) ? row.exact : readExact(row.exact) }
	if (DERIVED_KINDS.includes(row.kind)) return read
	read.unit = sourceUnit(row.unit)
	for (const column of LATER_COLUMNS) if (!Object.hasOwn(read, column)) read[column] = null
	return read
}

const carriesDerivation = (row) => row.operation !== null || row.operands?.length || row.derived_from?.length || row.formula !== null || row.factor !== null

/** Dimension 32: a stored exact must equal the row's own value at the value's decimal places. */
function valueExactDisagreement(row) {
	const exact = readExact(row.exact)
	const value = isString(row.value) ? readDecimal(row.value).replace(/^-(0+(?:\.0+)?)$/, "$1") : row.value
	if (!isRational(exact) || !isDecimal(value) || roundPlaces(toBig(exact), placesOf(value)) === value) return null
	return `value ${value} disagrees with exact ${exact.num}/${exact.den} at ${placesOf(value)} decimal places`
}
function unitFlaw(unit) {
	try {
		return isString(unit) && (canonicalUnit(unit) !== unit || inputScale(unit)) ? `unit ${unit} has no canonical stored text` : null
	} catch (error) {
		if (error instanceof RuleError) return `unit ${unit}: ${error.message}`
		throw error
	}
}

/**
 * What a loadable source row (read through readRow) still breaks under the strict dimensions: dev's
 * writer accepted it, so it loads, but derive and recompute refuse it as an operand with this shape.
 * addRow refuses a new row that has any. Empty for derived and converted rows.
 */
export function readFlaws(row) {
	if (!isObject(row) || DERIVED_KINDS.includes(row.kind)) return []
	const flaws = []
	if (carriesDerivation(row)) flaws.push({ shape: "dimension 1", detail: "a source row carries an operation or derivation fields", expected: "null operation and empty derivation fields on measured, quote, and assumed rows" })
	const unit = unitFlaw(row.unit)
	if (unit) flaws.push({ shape: "dimension 6", detail: unit, expected: "a registered or canonical unit without scale" })
	for (const detail of metadataErrors(row)) flaws.push({ shape: "dimension 18", detail, expected: "present, type-valid metadata; explicit null when unknown" })
	const unknownKeys = hasUnknownExactKeys(row.exact)
	const disagreement = unknownKeys ? null : valueExactDisagreement(row)
	if (unknownKeys) flaws.push({ shape: "dimension 7", detail: `exact has unknown keys: ${Object.keys(row.exact).filter((key) => key !== "num" && key !== "den").join(", ")}`, expected: "an exact with exactly num and den (the stored row is kept as written)" })
	if (disagreement) flaws.push({ shape: "dimension 32", detail: disagreement, expected: "an exact equal to value at the value's decimal places" })
	return flaws
}

/** @returns {string[]} every per-kind column error of one row; empty for an unknown kind. */
export function kindRuleErrors(candidate, at) {
	const rules = KIND_RULES[candidate.kind]
	if (rules === undefined) return []
	const errors = []
	const legacy = isLegacyDerived(candidate)
	const columns = legacy ? PRE_REGISTRY_COLUMNS : isCurrentDerived(candidate) ? KIND_COLUMNS : KIND_COLUMNS.filter((column) => column !== "operation")
	for (const column of columns) {
		const value = candidate[column] === undefined && LATER_COLUMNS.includes(column) ? null : candidate[column]
		const rule = RULES[legacy && column === "exact" ? "rational_or_null" : rules[column]]
		// An exact with unknown keys loads as written (never stripped); readFlaws refuses it at use and at write.
		if (column === "exact" && rules[column] !== "null" && hasUnknownExactKeys(value) && !isCurrentDerived(candidate)) continue
		if (rule.test(value, candidate)) continue
		errors.push(`${at}.${column} must be ${rule.says} for a ${candidate.kind} row`)
		if (rule.detail) errors.push(...rule.detail(value, `${at}.${column}`))
	}
	return errors
}

/** At-rest rules of current derived rows; source rows answer to readFlaws at use and at write instead. */
export function storedErrors(row) {
	if (!isCurrentDerived(row)) return []
	const errors = metadataErrors(row)
	try {
		if (canonicalUnit(row.unit) !== row.unit || inputScale(row.unit)) errors.push("unit must be canonical stored text")
	} catch (error) { errors.push(error.message) }
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
