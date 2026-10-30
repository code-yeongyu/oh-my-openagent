// fidelity-brief.mjs - parse the `## Fidelity` block of brief.md and decide whether it is locked.
//
// Grammar (fable-interview.md section 3, "Parser contract"): the block starts at a line
// `## Fidelity` and ends at the next `## ` heading. It holds the seven field lines below, in any
// order, each `<field>: <value> (answered_by: user|default|request|pending)`, plus an optional
// `asked: <field>, <field>` history line. Values carry no parentheses, and `answered_by: pending`
// is legal only with the value `pending`. Trailing whitespace on a line is ignored; a second
// `## Fidelity` block is a parse error. This module parses; it never interprets a value, which
// is each consumer's job. Plain Node ESM, node: builtins only.

import { readFileSync } from "node:fs"

export const FIDELITY_FIELDS = Object.freeze([
	"as of",
	"meaning check",
	"source floor",
	"derived numbers",
	"languages",
	"identifier classes",
	"fallback",
])
export const FIDELITY_ANSWERED_BY = Object.freeze(["user", "default", "request", "pending"])
const LOCKED_ANSWERED_BY = new Set(["user", "default", "request"])

export const FIDELITY_INCOMPLETE = "fidelity_interview_incomplete"
const INCOMPLETE_HINT =
	"A fidelity field is pending or missing in brief.md; answer the open question or record its default, then rerun."

const BLOCK_HEADING = /^## Fidelity\s*$/
const NEXT_HEADING = /^## /
const FIELD_LINE = /^([a-z][a-z ]*[a-z]): ([^()]+) \(answered_by: (user|default|request|pending)\)$/
const ASKED_LINE = /^asked:(.*)$/

function blockLines(markdown) {
	const lines = String(markdown)
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
	const headings = lines.flatMap((line, index) => (BLOCK_HEADING.test(line) ? [index] : []))
	if (headings.length === 0) return null
	const [start, ...duplicates] = headings
	const body = []
	for (let index = start + 1; index < lines.length; index += 1) {
		if (NEXT_HEADING.test(lines[index])) break
		body.push({ text: lines[index], line: index + 1 })
	}
	return { body, duplicates: duplicates.map((index) => index + 1) }
}

function parseAsked(rest, line, text, errors) {
	const names = rest
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean)
	const unknown = names.filter((name) => !FIDELITY_FIELDS.includes(name))
	if (unknown.length > 0) {
		errors.push(`line ${line}: malformed asked line, unknown field ${unknown.join(", ")}: ${text}`)
		return []
	}
	return names
}

function parseFieldLine({ text, line }, parsed, errors) {
	const match = FIELD_LINE.exec(text)
	if (!match) return errors.push(`line ${line}: malformed fidelity line: ${text}`)
	const [, field, rawValue, answeredBy] = match
	const value = rawValue.trim()
	if (!FIDELITY_FIELDS.includes(field)) return errors.push(`line ${line}: malformed fidelity line, unknown field "${field}": ${text}`)
	if (Object.hasOwn(parsed.fields, field)) return errors.push(`line ${line}: malformed fidelity line, duplicate field "${field}": ${text}`)
	if ((answeredBy === "pending") !== (value === "pending")) {
		return errors.push(`line ${line}: malformed fidelity line, value pending and answered_by: pending go together: ${text}`)
	}
	parsed.fields[field] = value
	parsed.answered_by[field] = answeredBy
}

/**
 * @param {string} briefMd the whole brief.md text
 * @returns {{ present: boolean, fields: Record<string, string>, answered_by: Record<string, string>,
 *   asked: string[], missing: string[], pending: string[], errors: string[] }}
 */
export function parseFidelityBlock(briefMd) {
	const parsed = { present: false, fields: {}, answered_by: {}, asked: [], missing: [], pending: [], errors: [] }
	const block = blockLines(briefMd)
	if (block !== null) {
		const { body, duplicates } = block
		parsed.present = true
		for (const line of duplicates) parsed.errors.push(`line ${line}: duplicate ## Fidelity block, only one is allowed`)
		let sawAsked = false
		for (const entry of body) {
			if (entry.text.trim() === "") continue
			const asked = ASKED_LINE.exec(entry.text)
			if (!asked) {
				parseFieldLine(entry, parsed, parsed.errors)
				continue
			}
			if (sawAsked) parsed.errors.push(`line ${entry.line}: malformed asked line, duplicate: ${entry.text}`)
			else parsed.asked = parseAsked(asked[1], entry.line, entry.text, parsed.errors)
			sawAsked = true
		}
	}
	parsed.missing = FIDELITY_FIELDS.filter((field) => !Object.hasOwn(parsed.fields, field))
	parsed.pending = FIDELITY_FIELDS.filter((field) => parsed.answered_by[field] === "pending")
	return parsed
}

/** Locked = no parse error and all seven fields present with answered_by user, default, or request. */
export function isLocked(parsed) {
	if (!parsed || parsed.errors.length > 0) return false
	return FIDELITY_FIELDS.every((field) => Object.hasOwn(parsed.fields, field) && LOCKED_ANSWERED_BY.has(parsed.answered_by[field]))
}

/** The brief's `meaning check` field turns the meaning verifier off only when it reads "off". */
export function meaningCheckEnabled(parsed) {
	return !/^off\b/iu.test(parsed?.fields?.["meaning check"] ?? "")
}

function incompleteDefect(briefPath, parsed) {
	const reasons = []
	if (!parsed.present) reasons.push("no ## Fidelity block")
	else if (parsed.missing.length > 0) reasons.push(`missing: ${parsed.missing.join(", ")}`)
	if (parsed.pending.length > 0) reasons.push(`pending: ${parsed.pending.join(", ")}`)
	return {
		code: FIDELITY_INCOMPLETE,
		severity: "blocker",
		integrity: true,
		selector: null,
		line: null,
		message: `${briefPath}: fidelity interview incomplete (${reasons.join("; ")})`,
		hint: INCOMPLETE_HINT,
	}
}

/**
 * The lock check the reader-facing CLI stages run before writing anything.
 * exitCode 0 = locked; 1 = pending, missing, or no brief (one `fidelity_interview_incomplete`
 * defect); 2 = malformed block (usage error, `errors` name the lines, no defect).
 * @param {string} briefPath
 */
export function requireLockedBrief(briefPath) {
	let markdown = ""
	try {
		markdown = readFileSync(briefPath, "utf8")
	} catch (error) {
		if (error?.code !== "ENOENT") throw error
	}
	const parsed = parseFidelityBlock(markdown)
	if (parsed.errors.length > 0) return { locked: false, exitCode: 2, defects: [], errors: parsed.errors, parsed }
	if (isLocked(parsed)) return { locked: true, exitCode: 0, defects: [], errors: [], parsed }
	return { locked: false, exitCode: 1, defects: [incompleteDefect(briefPath, parsed)], errors: [], parsed }
}
