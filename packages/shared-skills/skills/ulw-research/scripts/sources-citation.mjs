// sources-citation.mjs - the one Sources predicate shared by the static, trace, and claim gates.
//
// Under a Sources heading an element is split at <br>/block breaks and at sentence ends, and every
// sentence holding a numeral is checked exactly as under any other heading, unless EVERY numeral in
// it is a citation-field number. That is decided by the number's type and position only: a year
// (1900-2099), a full date, or a month/day (10/26, Oct 26, 2026. 10. 26.; a day count is not one);
// a page, volume, issue, number, or edition marker; a number inside a URL, DOI, arXiv id, ISBN or
// ISSN; a number inside a quoted title ("...", \u201C...\u201D, \u300C...\u300D,
// \u300E...\u300F, <cite>) or an <i>/<em> title directly before a URL or a date; a number inside link
// text; or a citation tag's digits. There is no word list: any other numeral makes the sentence a
// claim. A digit run glued to letters is a name, not a numeral (a hash, #12, GPT-4, v2.3.1, Q3, FY27),
// unless the letters are a unit, multiplier, or currency of units.mjs / numerals.mjs (50M, 10k, 3x,
// 2.5GB, 320m, 12%, 40percent, x3). A unit, multiplier, or percent on the right is checked before the
// letters on the left, so a word glued in front of a measure does not make it a name. A dotted version
// is a name, a European digit grouping (1.234.567) a numeral; a Korean ordinal (the je prefix, the
// jjae suffix) is a name and a Korean quarter a date. numeralKinds names the class of every digit run
// (citation-field, date, name, numeral); only a numeral is checked. A heading is not a prose sentence. Pure.
// Korean markers are \u escapes.

import { DOT_GROUPED, UNIT } from "./numerals.mjs"
import { dimensionOf, normalizeUnit } from "./units.mjs"

const SKIP = new Set(["script", "style", "template"])
const BREAK = new Set(["br", "p", "li", "div", "tr", "dd", "dt"])
// Abbreviations whose period never ends a citation sentence: pp., p., vol., no., ed., eds., et al., J. (initials).
const NOT_END = /(?:\b(?:pp?|vol|vols|no|nos|ed|eds|al|ch|sec|fig|vs|e\.g|i\.e|[A-Z])\.)$/i
const FACT = "\u0000"
const LINK = "\u0002"
const [CITE_OPEN, CITE_CLOSE, EM_OPEN, EM_CLOSE, A_OPEN, A_CLOSE] = ["\u0003", "\u0004", "\u0005", "\u0006", "\u0007", "\u0008"]
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b\\.?"
const YEAR = "(?:19|20)\\d{2}"
const URL = `(?:https?://|www\\.)[^\\s<>"${LINK}${A_CLOSE}]+?(?=[.,;:)\\]]?(?:\\s|$))`
/** A date at the start of a string: ISO/dotted/slashed, month-name, or Korean nyeon-wol-il. */
const DATE_AHEAD = new RegExp(`^(?:${YEAR}[-./]\\d{1,2}(?:[-./]\\d{1,2})?|\\d{1,2}[-./]\\d{1,2}[-./]${YEAR}|${MONTH}\\s+\\d{1,2},?\\s+${YEAR}|\\d{1,2}\\s+${MONTH}\\s+${YEAR}|${MONTH}\\s+${YEAR}|${YEAR}\\s*\\uB144|${YEAR}\\b)`, "i")
/** Citation fields a number can sit INSIDE (a checked sentence is traced without them, so a title is never a quotation). */
const CONTAINERS = [
	new RegExp(URL, "gi"),
	/\b(?:doi:\s*)?10\.\d{4,9}\/[^\s<>"]+/gi,
	/\b(?:arXiv:\s*)?\d{4}\.\d{4,5}(?:v\d+)?\b/gi,
	/\bIS[BS]N(?:-1[03])?:?\s*[\dXx][\dXx\s-]{6,16}[\dXx]/g,
	/\[(?:S|Source\s*)?\^?\d+\]/gi,
	/"[^"]*"|\u201C[^\u201D]*\u201D|\u300C[^\u300D]*\u300D|\u300E[^\u300F]*\u300F/g,
	new RegExp(`${CITE_OPEN}[^${CITE_CLOSE}]*${CITE_CLOSE}`, "g"),
	new RegExp(`${A_OPEN}[^${A_CLOSE}]*${A_CLOSE}`, "g"),
]
/** Date fields: full dates, month/day, a Korean quarter, dotted dates (with spaces, or DD.MM.YY), years and year ranges. */
const DATES = [
	new RegExp(`${YEAR}[-./]\\d{1,2}(?:[-./]\\d{1,2})?|\\d{1,2}[-./]\\d{1,2}[-./]${YEAR}`, "g"),
	new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+${YEAR})?|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}`, "gi"),
	/\d{1,2}\s*\uC6D4(?:\s*\d{1,2}\s*\uC77C)?|(?<!\d)[1-4]\s*\uBD84\uAE30/g,
	new RegExp(`${YEAR}\\.\\s+\\d{1,2}\\.\\s+\\d{1,2}\\.?`, "g"),
	/(?<![\d/.,])(?:1[0-2]|0?[1-9])\/(?:3[01]|[12]\d|0?[1-9])(?![\d/]|[.,]\d)/g,
	/(?<![\d.])\d{2}\.\d{2}\.\d{2}(?!\d|\.\d)/g,
	new RegExp(`(?<![\\d.,])${YEAR}(?:\\s*[-\\u2013~]\\s*${YEAR})?(?![\\d]|[.,]\\d)`, "g"),
]
/** Marker fields: page, volume, issue, number, and edition markers. */
const MARKERS = [
	/\b(?:pp?|pg|pages?)\.?\s*\d+(?:\s*[-\u2013]\s*\d+)?/gi,
	/\b(?:vols?|nos?|iss|ed)\.\s*\d+(?:\s*[-\u2013/]\s*\d+)*/gi,
	/\b(?:Vol|Volume|No|Issue|Number|volume|issue)\s+\d+(?:\s*[-\u2013/]\s*\d+)*/g,
	/\b\d+(?:st|nd|rd|th)\s+(?:ed\.|edition)|\bedition\s+\d+/gi,
	/\uC81C?\s*\d+(?:\s*[-\u2013~]\s*\d+)?\s*(?:\uCABD|\uBA74|\uAD8C|\uD638|\uD310)/g,
]
const TYPED = [...DATES, ...MARKERS]
const NUMERAL = /\d+(?:[.,]\d+)*/g
const UNIT_WORD = new RegExp(`^${UNIT}$`, "iu")
const UNIT_LEAD = new RegExp(`^${UNIT}`, "iu")
const LETTERS_AFTER = /^(?:[A-Za-z]+|[\uAC00-\uD7A3]+|\p{L}+)/u
/** A unit or currency symbol right after the digits (numerals.mjs SYMBOL_UNIT plus the currency signs). */
const SYMBOL_AFTER = /^(?:%|\u2030|\u00D7|\u00B0[CF]|\u2103|\u2109|[$\u20AC\u00A3\u00A5\u20A9])/
/** Korean ordinals: the prefix je ("je 3 hoe") and a counter followed by jjae ("3 beon jjae"). */
const KO_ORDINAL_BEFORE = /(?:^|[^\p{L}])\uC81C$/u
const KO_ORDINAL_AFTER = /^[\uAC00-\uD7A3]?\uC9F8/
const GROUPED = new RegExp(`^${DOT_GROUPED}$`)

/** Letters that make a glued digit run a quantity; a Korean run may carry a particle after its unit. */
function isUnit(letters) {
	if (!/^[\uAC00-\uD7A3]/.test(letters)) return UNIT_WORD.test(letters) || normalizeUnit(letters) !== null || normalizeUnit(letters.toLowerCase()) !== null
	if (UNIT_LEAD.test(letters)) return true
	for (let size = letters.length; size > 0; size--) if (normalizeUnit(letters.slice(0, size))) return true
	return false
}
/** A multiplier written before its number ("x3", "x1.5"): a standalone x, never a label ("w1:x02") or a leading zero. */
const isMultiplierBefore = (before, left, run) => dimensionOf(left) === "multiple" && /(?:^|[\s(])\p{L}+$/u.test(before) && !/^0\d/.test(run)
const isCurrency = (letters) => /^currency:/.test(dimensionOf(letters) ?? dimensionOf(letters.toUpperCase()) ?? "")

/**
 * The digit run [start, end) is part of a name: a dotted version ("0.30.14", not the grouping
 * "1.234.567"), a run after # or inside a word (letters on its left that are not a currency or a
 * standalone multiplier x: "W3C", "eb2b", "Q3", "FY27"; or glued on the left through - . _ /: "GPT-4", "H.15"),
 * or a run whose right-hand letters are not a unit, multiplier, or currency ("3D", "21st", "10-Q",
 * "1H25"). A unit, multiplier, or percent on the right makes the run a numeral first, whatever is
 * glued on its left ("revenue40%", "about300 people" written solid), unless Latin letters sit on both
 * sides, which is an identifier ("W3C", "eb2b").
 */
function isName(text, start, end) {
	const run = text.slice(start, end)
	if (/^\d+(?:\.\d+){2,}$/.test(run) && !GROUPED.test(run)) return true
	const before = text.slice(0, start)
	const rest = text.slice(end)
	if (KO_ORDINAL_BEFORE.test(before) || KO_ORDINAL_AFTER.test(rest)) return true
	const left = /(?<![A-Za-z])[A-Za-z]+$/.exec(before)?.[0] ?? /\p{L}+$/u.exec(before)?.[0]
	const right = LETTERS_AFTER.exec(rest)?.[0]
	const measure = right ? !/^\d/.test(rest.slice(right.length)) && isUnit(right) : SYMBOL_AFTER.test(rest)
	if (measure && !(right && /^[A-Za-z]/.test(right) && /[A-Za-z]$/.test(before))) return false
	if (left) return !isCurrency(left) && !(!right && isMultiplierBefore(before, left, run))
	if (right) return true
	if (before.endsWith("#") || /\p{L}/u.test(/([\p{L}\p{N}]+)[-._/]$/u.exec(before)?.[1] ?? "")) return true
	const joined = /^-(\p{L}[\p{L}\p{N}]*)/u.exec(rest)?.[1]
	return joined !== undefined && !isUnit(joined)
}

/** A fact element is bound by its ledger row, not traced here; it reads as one opaque token. */
const isFact = (node) => node.attrs?.["data-fact"] !== undefined || node.attrs?.["data-translates"] !== undefined || node.tag === "q" || node.tag === "blockquote"

function lines(node, out = [""]) {
	for (const child of node.children ?? []) {
		if (child.tag === "#text") out[out.length - 1] += child.text
		else if (SKIP.has(child.tag)) continue
		else if (isFact(child)) out[out.length - 1] += ` ${FACT} `
		else if (child.tag === "cite" || child.tag === "i" || child.tag === "em" || child.tag === "a") {
			const [open, close] = child.tag === "cite" ? [CITE_OPEN, CITE_CLOSE] : child.tag === "a" ? [A_OPEN, A_CLOSE] : [EM_OPEN, EM_CLOSE]
			out[out.length - 1] += open
			lines(child, out)
			out[out.length - 1] += close
			if (child.tag === "a" && /^https?:\/\//i.test(child.attrs?.href ?? "")) out[out.length - 1] += ` ${LINK} `
		} else {
			if (BREAK.has(child.tag)) out.push("")
			lines(child, out)
			if (BREAK.has(child.tag)) out.push("")
		}
	}
	return out
}

/** Spans [start, end) of the citation fields in `text`; an <i>/<em> run is a title only right before a URL, a link, or a date. */
function containerSpans(text) {
	const spans = []
	for (const re of CONTAINERS) for (const match of text.matchAll(re)) spans.push([match.index, match.index + match[0].length])
	for (const match of text.matchAll(new RegExp(`${EM_OPEN}[^${EM_CLOSE}]*${EM_CLOSE}`, "g"))) {
		const after = text.slice(match.index + match[0].length).replace(/^[\s,.:;()\u2013-]*/, "")
		if (after.startsWith(LINK) || after.startsWith(A_OPEN) || /^(?:https?:\/\/|www\.)/i.test(after) || DATE_AHEAD.test(after)) spans.push([match.index, match.index + match[0].length])
	}
	return spans
}

const typedSpans = (text, list) => list.flatMap((re) => [...text.matchAll(re)].map((match) => [match.index, match.index + match[0].length]))

const fieldSpans = (text) => [...containerSpans(text), ...typedSpans(text, TYPED)]

const inside = (spans, start, end) => spans.some(([s, e]) => start >= s && end <= e)

/** Sentences of one line; a period after an abbreviation, an initial, or inside a field never ends one. */
function sentences(line) {
	const spans = fieldSpans(line)
	const out = []
	let start = 0
	for (const match of line.matchAll(/[.!?](?=\s+\S|$)/g)) {
		const end = match.index + 1
		if (NOT_END.test(line.slice(start, end)) || inside(spans, match.index, end)) continue
		out.push(line.slice(start, end))
		start = end
	}
	out.push(line.slice(start))
	return out.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean)
}

/** Each digit run of `text` with its class: "citation-field" (a container or a marker), "date", "name", or "numeral". */
export function numeralKinds(text) {
	const [containers, markers, dates] = [containerSpans(text), typedSpans(text, MARKERS), typedSpans(text, DATES)]
	return [...text.matchAll(NUMERAL)].map((match) => {
		const [start, end] = [match.index, match.index + match[0].length]
		const kind = inside(containers, start, end) || inside(markers, start, end) ? "citation-field" : inside(dates, start, end) ? "date" : isName(text, start, end) ? "name" : "numeral"
		return { text: match[0], kind }
	})
}

/** The sentence holds a numeral that is not a citation-field number, so the gates check it. */
export const isClaimSegment = (text) => numeralKinds(text).some(({ kind }) => kind === "numeral")

/** A checked sentence as the gates read it: container fields (URL, DOI, title, tag) removed, every other number kept. */
function plain(text) {
	let out = ""
	let at = 0
	for (const [start, end] of containerSpans(text).sort((a, b) => a[0] - b[0])) {
		if (end <= at) continue
		out += `${text.slice(at, Math.max(at, start))} `
		at = end
	}
	return `${out}${text.slice(at)}`.replace(/[\u0002-\u0008]/g, " ").replace(/\s+/g, " ").trim()
}
const lineClaims = (line) => sentences(line).filter(isClaimSegment).map(plain)

/** The checked sentences of an element under Sources ([] when every numeral is a citation field). */
export function sourcesClaims(node) {
	if (/^h[1-6]$/.test(node.tag)) return []
	return lines(node).flatMap(lineClaims)
}

/** The checked sentences of loose text (a text node owned by a container element rather than a prose element). */
export function textClaims(text) {
	return lines({ children: [{ tag: "#text", text }] }).flatMap(lineClaims)
}
