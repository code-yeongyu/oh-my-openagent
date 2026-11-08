// placeholder.mjs - the fact pointer grammar of the fill step and its render helpers.
// Value pointers: {{F12:label}}, {{F12:label:value}}, {{F12:label:unit}}, {{F12:label:q}}.
// Claim prefixes from CLAIM_KINDS (V, D, A) precede any one pointer: {{D:F12:label:value}}, {{V:Q7:label:lead=18}}.
// Quote pointers: {{Q7:label}}, {{Q7:label:lead=18}}, {{Q7:label:from="x":to="y"}} (anchors are
// JSON strings, so they may hold a colon or an escaped quote). Labels are compared exactly by the
// caller; this module never guesses an id. Pure functions; node: builtins only.

import { parseNumeral } from "./numerals.mjs"
import { CLAIM_KINDS } from "./claim-kinds.mjs"

export const ELLIPSIS = "\u2026"

const ID = /^([FQ])[1-9]\d*$/
const LABEL = /^[^\s:{}"]+$/
const VALUE_MODES = new Set(["value", "unit", "q"])
const LEAD = /^lead=([1-9]\d*)$/
const LINEAGE = Object.freeze({ measured: "MEASURED", assumed: "ASSUMED", derived: "DERIVED", converted: "DERIVED" })

/** End index (exclusive) of a JSON string starting at `at`, or -1 when it is not closed on its line. */
function jsonStringEnd(text, at) {
	let i = at + 1
	while (i < text.length && text[i] !== '"' && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1
	return text[i] === '"' ? i + 1 : -1
}

function readJsonString(text, at) {
	if (text[at] !== '"') return null
	const end = jsonStringEnd(text, at)
	if (end === -1) return null
	try {
		return { value: JSON.parse(text.slice(at, end)), end }
	} catch {
		return null
	}
}

function parseAnchors(tail) {
	if (!tail.startsWith("from=")) return null
	const from = readJsonString(tail, 5)
	if (from === null || !tail.startsWith(":to=", from.end)) return null
	const to = readJsonString(tail, from.end + 4)
	if (to === null || to.end !== tail.length || from.value === "" || to.value === "") return null
	return { from: from.value, to: to.value }
}

/** @returns the parsed pointer, or { error } for a malformed one. */
export function parsePlaceholder(token) {
	if (!token.startsWith("{{") || !token.endsWith("}}")) return { error: "a placeholder is {{ID:label...}}" }
	const body = token.slice(2, -2)
	const marked = Object.entries(CLAIM_KINDS).find(([, entry]) => entry.prefix && body.startsWith(`${entry.prefix}:`))
	if (marked) {
		const [claimKind, entry] = marked
		const parsed = parsePlaceholder(`{{${body.slice(entry.prefix.length + 1)}}}`)
		return parsed.error || parsed.claimKind ? { error: "a claim prefix must precede one fact or quote pointer" } : { ...parsed, claimKind }
	}
	const colon = body.indexOf(":")
	const id = colon === -1 ? body : body.slice(0, colon)
	const idMatch = ID.exec(id)
	if (idMatch === null) return { error: `"${id}" is not an F<n> or Q<n> id` }
	if (colon === -1) return { error: `${id} has no label; write {{${id}:label}}` }
	const rest = body.slice(colon + 1)
	const second = rest.indexOf(":")
	const label = second === -1 ? rest : rest.slice(0, second)
	if (!LABEL.test(label)) return { error: `"${label}" is not a label` }
	const tail = second === -1 ? null : rest.slice(second + 1)
	const base = { id, kind: idMatch[1], label }
	if (idMatch[1] === "F") {
		if (tail === null) return { ...base, mode: "full" }
		return VALUE_MODES.has(tail) ? { ...base, mode: tail } : { error: `"${tail}" is not a value mode (value, unit, q)` }
	}
	if (tail === null) return { ...base, mode: "full", selector: "full" }
	const lead = LEAD.exec(tail)
	if (lead !== null) return { ...base, mode: "lead", lead: Number(lead[1]), selector: `lead=${lead[1]}` }
	const anchors = parseAnchors(tail)
	if (anchors === null) return { error: `"${tail}" is not a quote selector (lead=N or from="..":to="..")` }
	return { ...base, mode: "span", ...anchors, selector: `from=${anchors.from};to=${anchors.to}` }
}

/** End index (exclusive) of the pointer opened at `at`, or -1 when it is not closed on its line. */
function placeholderEnd(text, at) {
	let i = at + 2
	while (i < text.length && text[i] !== "\n") {
		if (text[i] === '"') {
			const end = jsonStringEnd(text, i)
			if (end === -1) return -1
			i = end
		} else if (text.startsWith("}}", i)) return i + 2
		else i++
	}
	return -1
}

/** Every `{{...}}` pointer in source order: [{ token, start, end, parsed }]. */
export function findPlaceholders(text) {
	const found = []
	let at = text.indexOf("{{")
	while (at !== -1) {
		const end = placeholderEnd(text, at)
		if (end === -1) {
			found.push({ token: text.slice(at, text.indexOf("\n", at) === -1 ? text.length : text.indexOf("\n", at)), start: at, end: at + 2, parsed: { error: "the placeholder is not closed on its line" } })
			at = text.indexOf("{{", at + 2)
			continue
		}
		const token = text.slice(at, end)
		found.push({ token, start: at, end, parsed: parsePlaceholder(token) })
		at = text.indexOf("{{", end)
	}
	return found
}

function occurrences(text, needle) {
	let count = 0
	for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) count++
	return count
}

function cut(quote, start, end) {
	return { text: `${start > 0 ? ELLIPSIS : ""}${quote.slice(start, end)}${end < quote.length ? ELLIPSIS : ""}`, start, end }
}

/** The contiguous span from `from` through `to`; each anchor must occur exactly once, in order. */
export function subSpan(quote, from, to) {
	if (occurrences(quote, from) !== 1 || occurrences(quote, to) !== 1) return null
	const start = quote.indexOf(from)
	const toAt = quote.indexOf(to)
	if (toAt < start || toAt + to.length < start + from.length) return null
	return cut(quote, start, toAt + to.length)
}

/** The first `n` whitespace-delimited words, with an ellipsis when words were cut. */
export function lead(quote, n) {
	const words = [...quote.matchAll(/\S+/g)]
	if (words.length <= n) return { text: quote, start: 0, end: quote.length }
	const last = words[n - 1]
	return cut(quote, 0, last.index + last[0].length)
}

/** The value and unit parts of a row's raw text ("4.2 eok won" -> value "4.2 eok", unit "won"). */
export function valueParts(row) {
	const unitText = parseNumeral(row.raw)?.unitRaw ?? row.unit
	const valueText = unitText && row.raw.endsWith(unitText) ? row.raw.slice(0, -unitText.length).trimEnd() : row.raw
	return { valueText, unitText: unitText ?? "" }
}

/** The quote interval holding the row's qualifier and its raw quantity, or null if absent. */
export function qualifiedText(row) {
	if (row.qualifier === null) return row.raw
	for (let numeral = parseNumeral(row.quote); numeral !== null; numeral = parseNumeral(row.quote, numeral.span[1])) {
		if (numeral.raw !== row.raw || numeral.qualifierRaw === null) continue
		const [start, end] = numeral.span
		const before = row.quote.lastIndexOf(numeral.qualifierRaw, start)
		const between = before === -1 ? [] : row.quote.slice(before + numeral.qualifierRaw.length, start).split(/\s+/u).filter(Boolean)
		if (before !== -1 && between.length <= 1) return row.quote.slice(before, end)
		const after = row.quote.indexOf(numeral.qualifierRaw, end)
		if (after !== -1) return row.quote.slice(start, after + numeral.qualifierRaw.length)
	}
	return null
}

export function escapeHtml(text) {
	return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

/** The elements the renderers below emit as fact spans; recognizers build their patterns from this. */
export const FACT_ELEMENT_TAGS = Object.freeze(["data", "q", "blockquote"])

/** `mode` "value" marks a bare value whose unit verify checks beside it; `claimKind` is the claim mark. */
export function renderValueHtml(row, text, { mode = "full", claimKind = null } = {}) {
	const unit = row.unit === null ? "" : ` data-unit="${escapeHtml(row.unit)}"`
	const marker = mode === "value" ? ' data-fact-mode="value"' : ""
	const mark = claimKind === null ? "" : ` data-claim-kind="${escapeHtml(claimKind)}"`
	return `<data class="fact" value="${escapeHtml(row.value)}" data-fact="${row.fact_id}"${unit}${marker}${mark} data-lineage="${LINEAGE[row.kind]}">${escapeHtml(text)}</data>`
}

export function renderQuote(row, selector, text, format, claimKind = null) {
	const marker = `[${row.source_id}]`
	if (format === "md") return `"${text}" ${marker}`
	const mark = claimKind === null ? "" : ` data-claim-kind="${escapeHtml(claimKind)}"`
	return `<q data-fact="${row.fact_id}"${mark} data-quote-sel="${escapeHtml(selector)}">${escapeHtml(text)}</q> ${marker}`
}

const RENDERED_MD_QUOTE = /^"([\s\S]*)" (\[S\d+\])$/u

/** The quote text and source marker of bytes renderQuote wrote for md, or null for any other layout. */
export function parseRenderedQuote(body) {
	const match = RENDERED_MD_QUOTE.exec(body)
	return match ? { text: match[1], marker: match[2] } : null
}

/** The attributed block that replaces a twice-failed sentence; entity and valid_at stay outside the quote. */
export function renderBlockquote(row, key, format) {
	const attribution = row.entity === null ? "" : `, on ${row.entity}${row.valid_at === null ? "" : ` (${row.valid_at})`}`
	const footer = `[${row.source_id}]${attribution}`
	if (format === "md") return `> "${row.quote}"\n> ${footer}`
	return `<blockquote data-fact="${row.fact_id}" data-replaced="${escapeHtml(key)}">"${escapeHtml(row.quote)}" <footer>${escapeHtml(footer)}</footer></blockquote>`
}
