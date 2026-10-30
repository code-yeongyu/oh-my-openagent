// polish-apply.mjs - checked, per-edit application of a proofread lane's polish edits.
//
// An edit whose before or after holds <, > or & is polish_edit_rejected (POLISH_MARKUP_REASON)
// before anything else, so no edit can create, alter, close or escape a tag, comment,
// bogus comment, CDATA section, entity or script, whatever the tokenizer models; a located region
// that overlaps a character reference or opens one (it starts inside `&name`) is rejected with
// POLISH_REFERENCE_REASON, so an edit can neither change nor complete an existing reference.
// Those two guards are the early, actionable refusals; the guarantee itself is the whole-document
// skeleton comparison (html-markup.skeletonChange) that polish-rules runs in both gates: every
// markup token and every character reference stays byte-identical, and an accepted edit's span
// holds no skeleton token, so any difference refuses the edit and reports polish_diff_fail.
// applyEdits(html, edits, ledger) applies each {before, after, reason} edit in edits-file order,
// against the output of the edits accepted before it. `before` must occur exactly once (runs of
// whitespace match any whitespace run) and must not cut through a fact span; otherwise the edit is
// polish_edit_unlocated. A located edit is applied whole or not at all: it is polish_edit_rejected
// when polish-rules.polishDefects(..., {ordered: true}) finds any defect between the current
// document and the document with the edit (per edit), or between the ORIGINAL input and the
// document with the edit (whole document: the baseline polish-diff uses). Ordered is stricter than
// polish-diff's multiset comparison and the last accepted candidate is the output, so a clean run
// is always polish-diff clean: no cross-edit case is left to the backstop. The rules see the
// text-node projection and freeze every markup byte, including script/style/template content.
// validatePolishEdits and POLISH_EDIT_FIELDS are the edit
// contract every caller (the CLI included) uses. No IO, no model. Plain Node ESM.

import { CHARACTER_REFERENCE } from "./html-markup.mjs"
import { factSpans } from "./polish-project.mjs"
import { polishDefects } from "./polish-rules.mjs"

export { numeralKeys, project, SLOT, termCounts, textOf } from "./polish-project.mjs"

/** The fields of one polish edit: before and after are required strings, reason an optional string. */
export const POLISH_EDIT_FIELDS = Object.freeze({ before: "required", after: "required", reason: "optional" })

/** Throws a TypeError naming the first edit that breaks POLISH_EDIT_FIELDS; returns the edits. */
export function validatePolishEdits(edits) {
	if (!Array.isArray(edits)) throw new TypeError("edits must be an array")
	edits.forEach((edit, index) => {
		if (edit === null || typeof edit !== "object" || Array.isArray(edit)) throw new TypeError(`edit ${index} must be an object`)
		for (const [field, need] of Object.entries(POLISH_EDIT_FIELDS)) {
			if (need === "optional" && edit[field] === undefined) continue
			if (typeof edit[field] !== "string") throw new TypeError(`edit ${index} needs ${need === "optional" ? "a string" : "string"} ${field}`)
		}
	})
	return edits
}

/** Characters an edit's before and after may never contain. */
export const POLISH_MARKUP_CHARACTERS = /[<>&]/
/** The actionable rejection reason for an edit holding a markup character. */
export const POLISH_MARKUP_REASON = "edit contains markup characters (<, >, &): route this section through the full fidelity gates"
/** The actionable rejection reason for a located region touching a character reference. */
export const POLISH_REFERENCE_REASON = "edit touches a character reference: route this section through the full fidelity gates"

/** True when [start, end) overlaps a character reference of html or starts inside one. */
export function touchesReference(html, start, end) {
	for (const match of String(html).matchAll(CHARACTER_REFERENCE)) {
		const stop = match.index + match[0].length
		if (match.index < end && (stop > start || (stop === start && !match[0].endsWith(";")))) return true
	}
	return false
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The single whitespace-normalized match of `before` in html as {start, end}, or {count} otherwise. */
function locate(html, before) {
	if (before.trim() === "") return { count: 0 }
	const pattern = new RegExp(before.split(/\s+/).map(escape).join("\\s+"), "g")
	const hits = [...html.matchAll(pattern)]
	return hits.length === 1 ? { count: 1, start: hits[0].index, end: hits[0].index + hits[0][0].length } : { count: hits.length }
}

/** The id of a fact span the region [start, end) cuts through (overlaps without containing), or null. */
export function cutSpan(html, start, end) {
	return factSpans(html).find((span) => span.start < end && span.end > start && !(start <= span.start && span.end <= end))?.id ?? null
}

/**
 * @param {string} html the filled report
 * @param {{ before: string, after: string, reason?: string }[]} edits in edits-file order
 * @param {{ rows: object[] }} ledger
 * @returns {{ out: string, applied: number[], rejected: { index: number, code: string, reason: string }[],
 *   unlocated: { index: number, code: string, reason: string }[] }}
 */
export function applyEdits(html, edits, ledger) {
	validatePolishEdits(edits)
	const original = String(html)
	const result = { out: original, applied: [], rejected: [], unlocated: [] }
	const defects = (candidate) => {
		const messages = [result.out, original].flatMap((base) => polishDefects(base, candidate, ledger, { ordered: true }).map((d) => d.message))
		return [...new Set(messages)]
	}
	edits.forEach((edit, index) => {
		const touches = POLISH_MARKUP_CHARACTERS.test(edit.before) || POLISH_MARKUP_CHARACTERS.test(edit.after)
		const where = locate(result.out, edit.before)
		if (where.count !== 1 && !touches) {
			result.unlocated.push({ index, code: "polish_edit_unlocated", reason: `before matches ${where.count} times; it must match exactly once` })
			return
		}
		const reasons = touches ? [POLISH_MARKUP_REASON] : []
		const candidate = where.count === 1 ? result.out.slice(0, where.start) + edit.after + result.out.slice(where.end) : result.out
		if (where.count === 1) {
			const cut = cutSpan(result.out, where.start, where.end)
			if (touchesReference(result.out, where.start, where.end)) reasons.push(POLISH_REFERENCE_REASON)
			reasons.push(...defects(candidate))
			if (cut !== null) reasons.push(`the edit cuts through fact span ${cut}`)
		}
		if (reasons.length > 0) {
			result.rejected.push({ index, code: "polish_edit_rejected", reason: reasons.join("; ") })
			return
		}
		result.out = candidate
		result.applied.push(index)
	})
	return result
}
