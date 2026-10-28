// fact-fill.mjs - the fill step: substitute every fact pointer in a report source from the
// ledger, all or nothing. Fatal errors (pointer_label_mismatch, unresolved_placeholder,
// quote_anchor_unresolved, unit_duplicated) return out null; warnings (particle_unverified,
// fallback_without_entity) never block. A twice-failed sentence can be replaced by an attributed
// block quote of its source row (replaceFailed). No IO, but not pure: unless options.view is set,
// it records each replaced sentence in options.replaceFailed through markReplaced. node: builtins only.

import { finalReading, rewriteParticle } from "./particles-ko.mjs"
import { failureCount, markReplaced, sentenceKey } from "./fidelity-state.mjs"
import { findPlaceholders, lead, qualifiedText, renderBlockquote, renderQuote, renderValueHtml, subSpan, valueParts } from "./placeholder.mjs"
import { splitSentences } from "./sentence-split.mjs"
import { CLAIM_KINDS } from "./claim-kinds.mjs"

/** The output formats fill renders. */
export const FILL_FORMATS = Object.freeze(["html", "md"])
const TRANSLATION = Object.freeze({
	html: /^\s*<span data-translates="(Q\d+)">[\s\S]*?<\/span>/u,
	md: /^\s*<!-- translates: (Q\d+) -->[^\n]*/u,
})
const HEADING = Object.freeze({ html: /<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/giu, md: /^#{1,6}[ \t]+(.+)$/gmu })

const lineOf = (text, at) => text.slice(0, at).split("\n").length

function resolveValue(row, parsed, format) {
	const { valueText, unitText } = valueParts(row)
	const text = { full: row.raw, value: valueText, unit: unitText, q: qualifiedText(row) }[parsed.mode]
	if (text === null) return { code: "quote_anchor_unresolved", message: `${row.fact_id} has qualifier ${row.qualifier}, but its quote holds no qualifier beside "${row.raw}"` }
	return { row, parsed, visible: text, rendered: format === "html" ? renderValueHtml(row, text, { mode: parsed.mode, claimKind: parsed.claimKind ?? null }) : text }
}

function resolveQuote(row, parsed, format) {
	const whole = { text: row.quote, start: 0, end: row.quote.length }
	const selection = parsed.mode === "lead" ? lead(row.quote, parsed.lead) : parsed.mode === "span" ? subSpan(row.quote, parsed.from, parsed.to) : whole
	if (selection === null) {
		return { code: "quote_anchor_unresolved", message: `from "${parsed.from}" and to "${parsed.to}" must each occur exactly once in ${row.fact_id}'s quote, in that order` }
	}
	const rendered = renderQuote(row, parsed.selector, selection.text, format, parsed.claimKind)
	return { row, parsed, visible: `[${row.source_id}]`, rendered, selector: parsed.selector, quote_span: [selection.start, selection.end] }
}

function resolve(found, rows, format) {
	const { parsed } = found
	if (parsed.error) return { code: "unresolved_placeholder", message: `${parsed.error}; for literal opening braces, write &#123;&#123; instead of {{ (including in code spans)` }
	const row = rows.get(parsed.id)
	if (row === undefined) return { code: "unresolved_placeholder", message: `${parsed.id} is not in the fact ledger` }
	if (row.status !== "active") return { code: "unresolved_placeholder", message: `${parsed.id} is ${row.status}; cite its replacement` }
	if (row.label !== parsed.label) return { code: "pointer_label_mismatch", message: `${parsed.id} has label "${row.label}", not "${parsed.label}"` }
	if (parsed.claimKind && !CLAIM_KINDS[parsed.claimKind].rowKinds.includes(row.kind)) return { code: CLAIM_KINDS[parsed.claimKind].defect, message: `${parsed.claimKind} does not accept a ${row.kind} row (${parsed.id})` }
	return parsed.kind === "Q" ? resolveQuote(row, parsed, format) : resolveValue(row, parsed, format)
}

/** A unit typed right after a pointer that already renders it: never absorbed, always an error. */
function unitDuplicated(text, item) {
	if (item.parsed.kind !== "F" || (item.parsed.mode !== "full" && item.parsed.mode !== "q")) return false
	const suffix = item.row.raw.replace(/^[\s\S]*\d/u, "").trim()
	const units = [item.row.unit, valueParts(item.row).unitText, suffix].filter((unit) => typeof unit === "string" && unit !== "")
	const following = text.slice(item.end).replace(/^[ \t]+/u, "")
	return units.some((unit) => following.startsWith(unit) && !/[A-Za-z0-9]/u.test(following[unit.length] ?? ""))
}

/*
 * Sentence-key rules (fidelity-state.mjs sentenceKey(slug, ids)); any other producer of keys must match:
 * - slug source: an HTML heading's id attribute wins over its text; md headings use their text.
 * - slugify: strip tags, lowercase, turn each run of non-letters/digits (\p{L}\p{N}) into "-",
 *   trim leading and trailing "-".
 * - a sentence takes the nearest heading that starts strictly before the sentence's start offset;
 *   a sentence before the first heading gets slug "".
 * - fact ids cited in the sentence are de-duplicated before sentenceKey sorts them.
 */
function slugify(text) {
	return text
		.replace(/<[^>]*>/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
}

function headings(text, format) {
	return [...text.matchAll(HEADING[format])].map((match) => {
		const id = format === "html" ? /\bid="([^"]*)"/u.exec(match[1])?.[1] : undefined
		return { at: match.index, slug: slugify(id ?? match[match.length - 1]) }
	})
}

/** Sentence offsets over the source with pointers, comments and (html) tags blanked to equal length. */
function sentencesOf(text, found, format) {
	let masked = text
	for (const item of found) masked = masked.slice(0, item.start) + "x".repeat(item.end - item.start) + masked.slice(item.end)
	const blank = (part) => part.replace(/[^\n]/gu, " ")
	masked = masked.replace(/<!--[\s\S]*?-->/gu, blank)
	if (format === "html") masked = masked.replace(/<[^>]*>/gu, blank)
	return splitSentences(masked)
}

function replacements(text, found, items, options, warnings) {
	const { format, replaceFailed: state } = options
	const marks = headings(text, format)
	const out = []
	for (const sentence of sentencesOf(text, found, format)) {
		const inside = items.filter((item) => item.start >= sentence.start && item.end <= sentence.end)
		if (inside.length === 0) continue
		const slug = marks.filter((mark) => mark.at < sentence.start).at(-1)?.slug ?? ""
		const key = sentenceKey(slug, [...new Set(inside.map((item) => item.row.fact_id))])
		if (failureCount(state, key) < 2) continue
		const rows = inside.map((item) => item.row)
		const source = rows.find((row) => row.kind === "quote") ?? rows.find((row) => row.source_id !== null && row.quote !== "")
		if (source === undefined) continue
		let rendered = options.fallback === "omit" ? "" : renderBlockquote(source, key, format)
		if (rendered !== "" && format === "md") {
			if (sentence.start > 0 && text[sentence.start - 1] !== "\n") rendered = `\n\n${rendered}`
			if (sentence.end < text.length && text[sentence.end] !== "\n") rendered = `${rendered}\n\n`
		}
		if (rendered !== "" && source.entity === null) {
			warnings.push({ code: "fallback_without_entity", token: key, line: lineOf(text, sentence.start), message: `${source.fact_id} has no entity; the block quote cites [${source.source_id}] alone` })
		}
		out.push({ start: sentence.start, end: sentence.end, key, source, rendered })
	}
	return out
}

/** The text after a pointer: rewrite a following Korean particle, and map a translation span. */
function afterPlaceholder(segment, item, context) {
	const { format, text, warnings, fillMap } = context
	const probeEnd = format === "html" && segment.includes("<") ? segment.indexOf("<") : segment.length
	const result = rewriteParticle(segment.slice(0, probeEnd), finalReading(item.visible, null))
	let next = segment
	if (result.applied) next = result.text + segment.slice(probeEnd)
	else if (result.candidate) {
		warnings.push({ code: "particle_unverified", token: item.token, line: lineOf(text, item.start), message: `the particle after ${item.token} was not rewritten; check it by eye` })
	}
	const translation = item.parsed.kind === "Q" ? TRANSLATION[format].exec(next) : null
	if (translation !== null && translation[1] === item.row.fact_id) {
		const span = translation[0].trimStart()
		const start = context.out.length + translation[0].length - span.length
		fillMap.push({ token: span, fact_id: translation[1], translates: translation[1], start, end: start + span.length, rendered: span })
	}
	return next
}

function assemble(text, parts, context) {
	let cursor = 0
	let previous = null
	const flush = (until) => {
		const segment = text.slice(cursor, until)
		context.out += previous?.parsed ? afterPlaceholder(segment, previous, context) : segment
	}
	for (const part of parts) {
		flush(part.start)
		const start = context.out.length
		if (part.parsed) {
			const extra = { ...(part.selector === undefined ? {} : { selector: part.selector, quote_span: part.quote_span }), ...(part.parsed.claimKind ? { claimKind: part.parsed.claimKind } : {}), ...(part.parsed.mode === "value" ? { mode: "value" } : {}) }
			context.fillMap.push({ token: part.token, fact_id: part.row.fact_id, start, end: start + part.rendered.length, rendered: part.rendered, ...extra })
		} else if (part.rendered !== "") {
			context.fillMap.push({ token: null, fact_id: part.source.fact_id, replaced: part.key, start, end: start + part.rendered.length, rendered: part.rendered })
		}
		context.out += part.rendered
		cursor = part.end
		previous = part
	}
	flush(text.length)
	return context.out
}

/**
 * @param {string} sourceText the report source with {{F..}} / {{Q..}} pointers
 * @param {{ rows: object[] }} ledger
 * @param {{ format?: "html"|"md", replaceFailed?: object, fallback?: "quote"|"omit", view?: boolean }} [options]
 * @returns {{ out: string|null, fillMap: object[], errors: object[], warnings: object[] }}
 */
export function fill(sourceText, ledger, options = {}) {
	const format = options.format ?? "html"
	if (!FILL_FORMATS.includes(format)) throw new TypeError(`format must be one of ${FILL_FORMATS.join(", ")}`)
	const rows = new Map(ledger.rows.map((row) => [row.fact_id, row]))
	const found = findPlaceholders(sourceText)
	const errors = []
	const warnings = []
	const items = []
	for (const pointer of found) {
		const resolved = resolve(pointer, rows, format)
		const line = lineOf(sourceText, pointer.start)
		if (resolved.code) errors.push({ code: resolved.code, token: pointer.token, line, message: resolved.message })
		else {
			const item = { ...pointer, ...resolved }
			if (unitDuplicated(sourceText, item)) {
				errors.push({ code: "unit_duplicated", token: pointer.token, line, message: `${pointer.token} already renders its unit; use {{${item.row.fact_id}:${item.row.label}:value}}` })
			} else items.push(item)
		}
	}
	if (errors.length > 0) return { out: null, fillMap: [], errors, warnings }
	const replaced = options.replaceFailed ? replacements(sourceText, found, items, { ...options, format }, warnings) : []
	const kept = items.filter((item) => !replaced.some((block) => item.start >= block.start && item.end <= block.end))
	const parts = [...kept, ...replaced].sort((a, b) => a.start - b.start)
	const context = { format, text: sourceText, warnings, fillMap: [], out: "" }
	const out = assemble(sourceText, parts, context)
	if (!options.view) for (const block of replaced) markReplaced(options.replaceFailed, block.key)
	return { out, fillMap: context.fillMap, errors, warnings }
}
