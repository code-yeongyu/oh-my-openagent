// fact-ledger-schema.mjs - the fact ledger's vocabulary and validation: row fields and defaults,
// kinds, statuses, qualifiers, and validateLedger over rows, status events, and their history.
// The grammar it encodes is references/fact-ledger-grammar.md; every per-kind column rule lives in
// KIND_RULES (fact-ledger-kinds.mjs), never here.
// Pure functions with no IO; fact-ledger.mjs owns reading, writing, and row changes. node: builtins only.

import { DECIMAL, isCount, isCurrentDerived, isNonEmpty, isObject, isString, kindRuleErrors, LATER_COLUMNS, readRow, storedErrors } from "./fact-ledger-kinds.mjs"
import { malformed } from "./unit-rules.mjs"

export { DECIMAL, isNonEmpty, isString } from "./fact-ledger-kinds.mjs"

export const LEDGER_SCHEMA_VERSION = 1
export const FACT_KINDS = Object.freeze(["measured", "quote", "derived", "assumed", "converted"])
export const FACT_STATUSES = Object.freeze(["active", "superseded", "retracted"])
export const OPERATIONS = Object.freeze(["sum", "diff", "growth", "ratio", "share", "convert", "expr"])
/** Canonical qualifier terms; surface forms in either language map onto these. */
export const QUALIFIERS = Object.freeze([
	"upper_inclusive",
	"lower_inclusive",
	"approximate",
	"near",
	"lower_exclusive",
	"upper_exclusive",
])

export const ROW_DEFAULTS = Object.freeze({
	value: null,
	unit: null,
	value_span: null,
	source_id: null,
	locator: null,
	locate_hint: null,
	snapshot_sha256: null,
	valid_at: null,
	qualifier: null,
	entity: null,
	sentence_id: null,
	observation_id: null,
	fuzzy: false,
	outside_floor: false,
	population: null,
	missing_rule: null,
	accounting_basis: null,
	snapshot_window: null,
	revision: null,
	exact: null,
	render: null,
	operation: null,
	operands: [],
	derived_from: [],
	formula: null,
	factor: null,
	rationale: null,
	context: null,
	precision: null,
	compatibility: null,
	status: "active",
})
/** Fields added after schema version 1 shipped: written on every new row, optional when reading an older ledger. */
const OPTIONAL_FIELDS = new Set(LATER_COLUMNS)
const REQUIRED = ["fact_id", "kind", "raw", "quote", "extracted_by", "observed_at", "label"]
export const ROW_FIELDS = Object.freeze([...REQUIRED, ...Object.keys(ROW_DEFAULTS)])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const LABEL = /^[a-z0-9_-]{1,32}$/
const FACT_REF = /^[FQ]\d+$/

function check(errors, condition, message) {
	if (!condition) errors.push(message)
}

function nullOr(value, test) {
	return value === null || test(value)
}

function validateRow(row, index, errors) {
	const at = `rows[${index}]`
	if (!isObject(row)) return errors.push(`${at} must be an object`)
	for (const key of ROW_FIELDS) check(errors, OPTIONAL_FIELDS.has(key) || Object.hasOwn(row, key), `${at}.${key} is required`)
	for (const key of Object.keys(row)) check(errors, ROW_FIELDS.includes(key), `${at}.${key} is not a ledger field`)
	check(errors, FACT_KINDS.includes(row.kind), `${at}.kind must be one of ${FACT_KINDS.join(", ")}`)
	// Dimension 31 wins at read time: per-kind rules see the row as readRow normalizes it.
	errors.push(...kindRuleErrors(readRow(row), at))
	errors.push(...storedErrors(row).map((e) => `${at}.${e}`))
	if (isCurrentDerived(row)) {
		const problem = malformed(row)
		if (problem) errors.push(`${at}: ${problem}`)
	}
	check(errors, row.unit === undefined || nullOr(row.unit, isNonEmpty), `${at}.unit must be null or a non-empty token`)
	for (const key of ["raw", "quote"]) check(errors, row[key] === undefined || isString(row[key]), `${at}.${key} must be a string`)
	check(errors, row.extracted_by === undefined || isNonEmpty(row.extracted_by), `${at}.extracted_by must be a non-empty string`)
	check(errors, row.observed_at === undefined || (isString(row.observed_at) && ISO_DATE.test(row.observed_at)), `${at}.observed_at must be an ISO timestamp`)
	check(errors, row.label === undefined || (isString(row.label) && LABEL.test(row.label)), `${at}.label must match [a-z0-9_-]{1,32}`)
	const span = row.value_span
	check(errors, span === undefined || nullOr(span, (v) => Array.isArray(v) && v.length === 2 && v.every(isCount) && v[0] <= v[1]), `${at}.value_span must be null or [start, end]`)
	for (const key of ["locate_hint", "valid_at", "entity", "observation_id", "missing_rule", "accounting_basis", "formula", "render"]) {
		if (row[key] !== undefined) check(errors, nullOr(row[key], isString), `${at}.${key} must be null or a string`)
	}
	for (const key of ["population", "snapshot_window", "revision"]) {
		if (row[key] !== undefined) check(errors, nullOr(row[key], (v) => isString(v) || isObject(v)), `${at}.${key} must be null, a string, or an object`)
	}
	if (row.qualifier !== undefined) check(errors, nullOr(row.qualifier, (v) => QUALIFIERS.includes(v)), `${at}.qualifier must be null or one of ${QUALIFIERS.join(", ")}`)
	if (row.sentence_id !== undefined) check(errors, nullOr(row.sentence_id, (v) => isString(v) && /^S\d+:s\d+$/.test(v)), `${at}.sentence_id must be null or S<n>:s<k>`)
	for (const key of ["fuzzy", "outside_floor"]) {
		if (row[key] !== undefined) check(errors, typeof row[key] === "boolean", `${at}.${key} must be a boolean`)
	}
	if (row.operation !== undefined) check(errors, nullOr(row.operation, (v) => OPERATIONS.includes(v)), `${at}.operation must be null or one of ${OPERATIONS.join(", ")}`)
	for (const key of ["operands", "derived_from"]) {
		if (row[key] !== undefined) check(errors, Array.isArray(row[key]) && row[key].every((v) => isString(v) && FACT_REF.test(v)), `${at}.${key} must be an array of fact ids`)
	}
	if (row.factor !== undefined) check(errors, nullOr(row.factor, (v) => isString(v) && DECIMAL.test(v)), `${at}.factor must be null or a decimal string`)
	check(errors, row.status === undefined || FACT_STATUSES.includes(row.status), `${at}.status must be one of ${FACT_STATUSES.join(", ")}`)
}

export function rowErrors(row) {
	const errors = []
	validateRow(row, 0, errors)
	return errors
}

// The status machine and event rule of references/fact-ledger-grammar.md. validateLedger replays
// events through transitionError, and every writer in fact-ledger.mjs calls it before appending.
export const TRANSITIONS = Object.freeze({ active: Object.freeze(["retracted", "superseded"]), retracted: Object.freeze([]), superseded: Object.freeze([]) })
const EVENT_FIELDS = Object.freeze(["fact_id", "from", "to", "replacement", "reason"])

/**
 * @param {Map<string, string>} statuses each fact's status at the event's position
 * @returns {string | null} why the event is not a legal transition, or null
 */
export function transitionError(statuses, event) {
	if (!isObject(event)) return "an event must be an object"
	const id = event.fact_id
	if (!statuses.has(id)) return `no ledger row ${id}`
	if (EVENT_FIELDS.some((key) => !Object.hasOwn(event, key)) || Object.keys(event).some((key) => !EVENT_FIELDS.includes(key))) {
		return `${id}: an event has exactly the fields ${EVENT_FIELDS.join(", ")}`
	}
	const current = statuses.get(id)
	if (event.from !== current) return `${id} is ${current}, but the event moves it from ${event.from}`
	if (!TRANSITIONS[current].includes(event.to)) return `${id} cannot move from ${current} to ${event.to}`
	if (event.to === "superseded") {
		if (event.replacement === null) return `supersede ${id} needs a replacement row; use retract for a fact with no replacement`
		if (event.replacement === id) return `${id} cannot be its own replacement`
		if (!statuses.has(event.replacement)) return `no replacement row ${event.replacement} for ${id}`
		if (statuses.get(event.replacement) !== "active") return `replacement row ${event.replacement} is ${statuses.get(event.replacement)} (superseding ${id})`
	} else if (event.replacement !== null) return `${id} is ${event.to} but names replacement ${event.replacement}`
	if (!isNonEmpty(event.reason)) return `a reason is required to mark ${id} ${event.to}`
	return null
}

/** Replay every event from all-active; each row's status must be where its event chain leaves it. */
function validateHistory(ledger, errors) {
	const statuses = new Map(ledger.rows.filter(isObject).map((row) => [row.fact_id, "active"]))
	const counts = new Map()
	ledger.events.forEach((event, index) => {
		const problem = transitionError(statuses, event)
		if (problem) errors.push(`events[${index}]: ${problem}`)
		if (!isObject(event) || !statuses.has(event.fact_id) || !FACT_STATUSES.includes(event.to)) return
		statuses.set(event.fact_id, event.to)
		counts.set(event.fact_id, (counts.get(event.fact_id) ?? 0) + 1)
	})
	ledger.rows.forEach((row, index) => {
		if (!isObject(row) || !FACT_STATUSES.includes(row.status)) return
		const to = statuses.get(row.fact_id)
		if (!counts.has(row.fact_id)) check(errors, row.status === "active", `rows[${index}]: ${row.fact_id} is ${row.status} but has no status event`)
		else check(errors, to === row.status, `rows[${index}]: ${row.fact_id} has status ${row.status} but its last event moves it to ${to}`)
	})
}

/** operands and derived_from name existing rows, never the row itself, and close no cycle. */
export function provenanceErrors(rows) {
	const errors = []
	const refs = new Map()
	for (const row of rows) if (isObject(row)) refs.set(row.fact_id, [row.operands, row.derived_from].flatMap((list) => (Array.isArray(list) ? list : [])))
	rows.forEach((row, index) => {
		for (const key of ["operands", "derived_from"]) {
			if (!isObject(row) || !Array.isArray(row[key])) continue
			for (const ref of row[key]) {
				if (ref === row.fact_id) errors.push(`rows[${index}].${key}: ${ref} references itself`)
				else check(errors, refs.has(ref), `rows[${index}].${key}: ${row.fact_id} references ${ref}, which has no ledger row`)
			}
		}
	})
	const state = new Map()
	for (const root of refs.keys()) {
		const stack = [{ id: root, finish: false }]
		const path = []
		while (stack.length) {
			const { id, finish } = stack.pop()
			if (state.get(id) === "done") continue
			if (finish) { state.set(id, "done"); path.pop(); continue }
			if (state.get(id) === "open") return [...errors, `${id} derives from itself through cycle ${[...path, id].join(" -> ")}`]
			state.set(id, "open")
			path.push(id)
			stack.push({ id, finish: true })
			for (const next of refs.get(id)) if (next !== id && refs.has(next)) stack.push({ id: next, finish: false })
		}
	}
	return errors
}

/** @returns {string[]} every schema error; empty when the ledger is valid. */
export function validateLedger(ledger) {
	const errors = []
	if (!isObject(ledger)) return ["ledger must be an object"]
	check(errors, ledger.schemaVersion === LEDGER_SCHEMA_VERSION, `schemaVersion must be ${LEDGER_SCHEMA_VERSION}`)
	if (!Array.isArray(ledger.rows)) return [...errors, "rows must be an array"]
	ledger.rows.forEach((row, index) => validateRow(row, index, errors))
	const ids = new Set()
	const labels = new Set()
	ledger.rows.forEach((row, index) => {
		if (!isObject(row)) return
		check(errors, !ids.has(row.fact_id), `rows[${index}].fact_id ${row.fact_id} is a duplicate`)
		check(errors, row.label === undefined || !labels.has(row.label), `rows[${index}]: ${row.fact_id} has duplicate label ${row.label}`)
		ids.add(row.fact_id)
		labels.add(row.label)
	})
	errors.push(...provenanceErrors(ledger.rows))
	if (Array.isArray(ledger.events)) validateHistory(ledger, errors)
	else errors.push("events must be an array")
	return errors
}
