// fact-ledger.mjs - the verbatim fact ledger: one row per measured, quoted, derived, assumed,
// or converted value, with its source locator and exact rational. Rows are never deleted:
// retract and supersede change status and append an event. Validation and the field vocabulary
// live in fact-ledger-schema.mjs and are re-exported here. node: builtins only.

import { existsSync } from "node:fs"
import { join } from "node:path"

import { CliError, readJsonFile, writeJsonAtomic } from "./cli-support.mjs"
import { DECIMAL, exactComesFromValue, exactFromDecimal, idPrefix, isString } from "./fact-ledger-kinds.mjs"
import { LEDGER_SCHEMA_VERSION, ROW_DEFAULTS, ROW_FIELDS, transitionError, validateLedger } from "./fact-ledger-schema.mjs"

export { exactFromDecimal } from "./fact-ledger-kinds.mjs"
export { FACT_KINDS, FACT_STATUSES, LEDGER_SCHEMA_VERSION, OPERATIONS, QUALIFIERS, ROW_FIELDS, TRANSITIONS, transitionError, validateLedger } from "./fact-ledger-schema.mjs"

export const LEDGER_FILENAME = "fact-ledger.json"

export function emptyLedger() {
	return { schemaVersion: LEDGER_SCHEMA_VERSION, rows: [], events: [] }
}

function assertValid(ledger) {
	const errors = validateLedger(ledger)
	if (errors.length > 0) throw new CliError(`invalid fact ledger: ${errors.join("; ")}`)
}

export function readLedger(dir) {
	const file = join(dir, LEDGER_FILENAME)
	if (!existsSync(file)) return emptyLedger()
	const ledger = readJsonFile(file)
	assertValid(ledger)
	return ledger
}

export function writeLedger(dir, ledger) {
	assertValid(ledger)
	const file = join(dir, LEDGER_FILENAME)
	writeJsonAtomic(file, ledger)
	return file
}

const ID_NUMBER = Object.freeze({ F: /^F(\d+)$/, Q: /^Q(\d+)$/ })

/** The next id with the kind's prefix from KIND_RULES (F<n> for value rows, Q<n> for quotes). */
export function nextId(ledger, kind) {
	const prefix = idPrefix(kind)
	let max = 0
	for (const row of ledger.rows) {
		const match = ID_NUMBER[prefix].exec(row.fact_id ?? "")
		if (match) max = Math.max(max, Number(match[1]))
	}
	return `${prefix}${max + 1}`
}

/**
 * Fill defaults, assign the next id, validate the whole ledger (provenance included), then append.
 * Only kinds whose KIND_RULES exact is from_value (measured) get exact from their decimal:
 * derived and converted rows carry the exact that derive computed from the operands and factor,
 * never one read back from the rounded value.
 */
export function addRow(ledger, row) {
	const filled = { ...structuredClone(ROW_DEFAULTS), ...row, fact_id: row.fact_id ?? nextId(ledger, row.kind) }
	if (exactComesFromValue(filled.kind) && filled.exact === null && isString(filled.value) && DECIMAL.test(filled.value)) {
		filled.exact = exactFromDecimal(filled.value)
	}
	const ordered = Object.fromEntries(ROW_FIELDS.filter((key) => Object.hasOwn(filled, key)).map((key) => [key, filled[key]]))
	for (const key of Object.keys(filled)) if (!ROW_FIELDS.includes(key)) ordered[key] = filled[key]
	assertValid({ ...ledger, rows: [...ledger.rows, ordered] })
	ledger.rows.push(ordered)
	return ordered
}

/** Build the event from the row's current status and append it only if transitionError allows it. */
function changeStatus(ledger, id, to, replacement, reason) {
	const row = ledger.rows.find((candidate) => candidate.fact_id === id)
	const event = { fact_id: id, from: row?.status ?? null, to, replacement: replacement ?? null, reason }
	const problem = transitionError(new Map(ledger.rows.map((candidate) => [candidate.fact_id, candidate.status])), event)
	if (problem) throw new CliError(problem)
	ledger.events.push(event)
	row.status = to
	return row
}

export function retractRow(ledger, id, reason) {
	return changeStatus(ledger, id, "retracted", null, reason)
}

export function supersedeRow(ledger, id, replacementId, reason) {
	return changeStatus(ledger, id, "superseded", replacementId, reason)
}

function cell(value) {
	return value === null || value === undefined ? "" : String(value).replace(/\|/g, "\\|").replace(/\n/g, " ")
}

/** The `--view` table: one line per row, retracted and superseded rows included. */
export function renderLedgerMarkdown(ledger) {
	const lines = ["| fact_id | kind | label | value | unit | source | status | raw |", "|---|---|---|---|---|---|---|---|"]
	for (const row of ledger.rows) {
		lines.push(`| ${[row.fact_id, row.kind, row.label, row.value, row.unit, row.source_id, row.status, row.raw].map(cell).join(" | ")} |`)
	}
	return `${lines.join("\n")}\n`
}
