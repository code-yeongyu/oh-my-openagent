// numerals.mjs - shared numeral patterns and the numeral parser.
//
// NUM, UNIT, NOT_CLAIMS and CLAIMS are the claim-detection patterns the unsourced-number gate uses
// (gates-text.mjs imports them from here). parseNumeral reads one numeral into an exact decimal
// string: thousands separators, Korean and Latin scale words, percent and percentage points, the
// English number words one to twelve, an adjacent currency symbol or unit, and an adjacent bounding
// qualifier. No numeral is ever passed through Number(). Plain Node ESM, sibling imports only.

import { add, fromDecimal, mul, toDecimal } from "./rational.mjs"
import { normalizeUnit } from "./units.mjs"

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?"
/** Stripped before claim detection: dates, versions, figure refs, times, bare years. */
export const NOT_CLAIMS = [
	/\b\d{4}[-./]\d{1,2}(?:[-./]\d{1,2})?\b/g,
	/\b\d{2}\.\d{2}\.\d{2}\b/g,
	/\d{2,4}\s*\uB144\s*\d{1,2}\s*\uC6D4(?:\s*\d{1,2}\s*\uC77C)?/g,
	/\d{1,2}\s*\uC6D4(?:\s*\d{1,2}\s*\uC77C)?/g,
	/(?:19|20)\d{2}\s*\uB144/g,
	new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, "gi"),
	new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:\\s+\\d{4})?`, "gi"),
	/\bv\d+(?:\.\d+)*\b|\b\d+(?:\.\d+){2,}\b/gi,
	/\b(?:version|ver\.?|release)\s*\d+(?:\.\d+)*/gi,
	/\b(?:fig(?:ure)?\.?|table|chart|section|step|phase|wave|part)\s*\d+(?:\.\d+)*/gi,
	/(?:\uADF8\uB9BC|\uB3C4\uD45C|\uD45C|\uBC84\uC804)\s*\d+(?:\.\d+)*/g,
	/\b\d{1,2}:\d{2}\b/g,
	/\b(?:19|20)\d{2}s?\b/g,
]
export const NUM = "(?<![\\p{L}\\d.,])\\d+(?:[.,]\\d+)*"
export const UNIT =
	"(?:%|\\u2030|\\u00D7|\\uD37C\\uC13C\\uD2B8|\\uB2EC\\uB7EC|\\uC720\\uB85C|\\uC5D4|\\uC6D0|\\uB9CC|\\uC5B5|\\uC870|\\uCC9C|\\uCD08|\\uBD84|\\uC2DC\\uAC04|\\uC77C|\\uC8FC|\\uAC1C\\uC6D4|\\uB144|\\uBA85|\\uAC74|\\uAC1C|\\uD68C|\\uBC88|\\uBC30" +
	"|(?:percent|pp|bps?|x|k|m|b|bn|million|billion|thousand|trillion|usd|krw|eur|ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?|kb|mb|gb|tb|users?|people|employees|engineers|tokens?|requests?|stars?|downloads?|customers?)(?![\\p{L}\\d]))"
export const CLAIMS = [
	new RegExp(`[$\\u20AC\\u00A3\\u00A5\\u20A9]\\s?${NUM}`, "u"),
	new RegExp(`${NUM}\\s?${UNIT}`, "iu"),
	/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])/,
	/(?<![\d.])\d+\.\d+(?![\d.])/,
]

const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
const WORD_RE = new RegExp(`\\b(?:${WORDS.join("|")})\\b`, "gi")
/** Korean scale words: cheon (1e3) inside a group, then man, eok, jo as group scales. */
const CHEON = "\uCC9C"
const BIG = new Map([["\uB9CC", 10000n], ["\uC5B5", 100000000n], ["\uC870", 1000000000000n]])
/** A scale word that starts a longer word is not a scale: jogak (pieces), mankeum (as much as). */
const KO_GROUP = /^(\s?)(?:(\uCC9C)?([\uB9CC\uC5B5\uC870])|(\uCC9C))(?![\uAC01\uD07C])/
const KO_NEXT = new RegExp(`^\\s?(${NUM})(\uCC9C)?([\uB9CC\uC5B5\uC870])?`, "u")
const LATIN_SCALE = /^(?:(k|K|M|bn|B)|\s(thousand|million|billion|trillion|bn))(?![\p{L}\d])/u
const LATIN_FACTOR = { k: 1000n, K: 1000n, M: 1000000n, bn: 1000000000n, B: 1000000000n, thousand: 1000n, million: 1000000n, billion: 1000000000n, trillion: 1000000000000n }
const CURRENCY = "$\u20AC\u00A3\u00A5\u20A9"
const SYMBOL_UNIT = /^\s?(%p|%|\u2030|\u00D7|\u00B0C|\u00B0F|\u2103|\u2109)/
const LATIN_UNIT = /^\s?([A-Za-z]+)(?![\p{L}\d])/u
const HANGUL_UNIT = /^\s?([\uAC00-\uD7A3]+)/
/** "3 bun-ui 1" is the fraction one third, not 3 minutes. */
const FRACTION = /^\s?\uBD84\uC758\s?\d/
const UNIT_AFTER = new RegExp(`^\\s?${UNIT}`, "iu")
const NUM_AT = new RegExp(`^${NUM}`, "u")
/** Range separators: hyphen, en dash, tilde, "to". */
const RANGE_SEP = /^(?:\s?[-\u2013~]\s?|\sto\s)/
const SIGN = "-\u2212"
/** Bounding qualifiers: before the value (Korean and English) and right after it (Korean). */
const QUALIFIERS_BEFORE = ["up to", "at least", "at most", "more than", "less than", "about", "approximately", "nearly", "over", "under", "\uCD5C\uB300", "\uCD5C\uC18C", "\uC57D"]
const QUALIFIER_AFTER = /^\s?(\uC774\uC0C1|\uC774\uD558|\uBBF8\uB9CC|\uCD08\uACFC|\uB0B4\uC678|\uAE4C\uC9C0)/

/** "1,237" -> "1237"; a malformed group ("1,23") keeps only the leading plain number. */
function cleanDigits(raw) {
	if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) return { digits: raw.replace(/,/g, ""), length: raw.length }
	const plain = /^\d+(?:\.\d+)?/.exec(raw)[0]
	return { digits: plain, length: plain.length }
}

/** The bare-year and four-digit-date patterns: a numeral they cover can still be a value. */
const YEAR_SHAPED = new Set([NOT_CLAIMS[0], NOT_CLAIMS[12]])

function excludedRanges(text) {
	const ranges = []
	for (const re of NOT_CLAIMS) {
		for (const match of text.matchAll(re)) ranges.push([match.index, match.index + match[0].length, YEAR_SHAPED.has(re)])
	}
	return ranges
}

/** A year-shaped numeral is a value when it has a decimal part or a currency, scale word or unit touches it. */
function anchored(text, at, end, digits) {
	if (digits.includes(".") || (at > 0 && CURRENCY.includes(text[at - 1]))) return true
	return UNIT_AFTER.test(text.slice(end)) || unitAfter(text, end) !== null
}

/**
 * First digit run or number word at or after `from` that no NOT_CLAIMS pattern covers. A year-shaped
 * match exactly over the numeral (not "2020s", not "2020-03") is lifted when the numeral is anchored.
 */
function findStart(text, from, ranges) {
	const covering = (at) => ranges.filter(([s, e]) => at >= s && at < e)
	let digit = null
	for (const match of text.slice(from).matchAll(new RegExp(NUM, "gu"))) {
		const at = from + match.index
		const candidate = { at, ...cleanDigits(match[0]) }
		const end = at + candidate.length
		const cover = covering(at)
		const lifted = cover.every(([s, e, yearShaped]) => yearShaped && s === at && e <= end)
		if (cover.length === 0 || (lifted && anchored(text, at, end, candidate.digits))) {
			digit = candidate
			break
		}
	}
	const free = (at) => covering(at).length === 0
	for (const match of text.slice(from).matchAll(WORD_RE)) {
		const at = from + match.index
		if (digit && digit.at < at) break
		if (free(at)) return { at, digits: String(WORDS.indexOf(match[0].toLowerCase()) + 1), length: match[0].length }
	}
	return digit
}

/** Korean groups such as "4jo 2,000eok": each later group needs a smaller scale. */
function koreanScale(text, at, digits) {
	const first = KO_GROUP.exec(text.slice(at))
	if (!first) return null
	const big = first[3] ? BIG.get(first[3]) : 1n
	const firstFactor = (first[2] || first[4] ? 1000n : 1n) * big
	let value = mul(fromDecimal(digits), firstFactor)
	let end = at + first[0].length
	let last = first[3] ? big : 0n
	let groups = 1
	while (last > 1n) {
		const next = KO_NEXT.exec(text.slice(end))
		if (!next) break
		const factor = (next[2] ? 1000n : 1n) * (next[3] ? BIG.get(next[3]) : 1n)
		if (factor <= 1n || factor >= last) break
		value = add(value, mul(fromDecimal(cleanDigits(next[1]).digits), factor))
		end += next[0].length
		last = next[3] ? BIG.get(next[3]) : 0n
		groups++
	}
	return { value, end, factor: groups === 1 ? firstFactor : null }
}

/** Scale words after a numeral: { value (rational) | null, end, factor | null (one plain factor) }. */
function scaled(text, end, digits) {
	const korean = koreanScale(text, end, digits)
	if (korean) return korean
	const latin = LATIN_SCALE.exec(text.slice(end))
	if (!latin) return { value: null, end, factor: null }
	const factor = LATIN_FACTOR[latin[1] ?? latin[2].toLowerCase()]
	return { value: mul(fromDecimal(digits), factor), end: end + latin[0].length, factor }
}

/** The second endpoint of "5-10", "5 to 10", "5~10" or "5\u201310", or null. */
function rangeEnd(text, at, ranges) {
	const sep = RANGE_SEP.exec(text.slice(at))
	if (!sep) return null
	const pos = at + sep[0].length
	const num = NUM_AT.exec(text.slice(pos))
	if (!num || ranges.some(([s, e]) => pos >= s && pos < e)) return null
	const { digits, length } = cleanDigits(num[0])
	const scale = scaled(text, pos + length, digits)
	return { value: scale.value ? toDecimal(scale.value) : digits, end: scale.end, factor: scale.factor }
}

function unitAfter(text, at) {
	const rest = text.slice(at)
	if (FRACTION.test(rest)) return null
	const symbol = SYMBOL_UNIT.exec(rest)
	if (symbol) return { unitRaw: symbol[1], end: at + symbol[0].length }
	const latin = LATIN_UNIT.exec(rest)
	if (latin) return normalizeUnit(latin[1]) ? { unitRaw: latin[1], end: at + latin[0].length } : null
	const hangul = HANGUL_UNIT.exec(rest)
	if (!hangul) return null
	const lead = hangul[0].length - hangul[1].length
	for (let size = hangul[1].length; size > 0; size--) {
		const candidate = hangul[1].slice(0, size)
		if (!BIG.has(candidate) && candidate !== CHEON && normalizeUnit(candidate)) return { unitRaw: candidate, end: at + lead + size }
	}
	return null
}

function qualifierBefore(text, at) {
	const tokens = text.slice(0, at).trim().split(/\s+/).slice(-2).map((token) => token.replace(/^[^\p{L}]+/u, ""))
	for (const phrase of QUALIFIERS_BEFORE) {
		const words = phrase.split(" ")
		for (let skip = 0; skip + words.length <= tokens.length; skip++) {
			const window = tokens.slice(tokens.length - skip - words.length, tokens.length - skip)
			if (window.join(" ").toLowerCase() === phrase) return window.join(" ")
		}
	}
	return null
}

/**
 * The first numeral at or after `from`: { value, raw, span: [start, end], unitRaw, qualifierRaw },
 * or null. `value` is an exact decimal string with scale words folded in ("3eok won" -> "300000000",
 * unit "won") and a leading minus sign ("-" or U+2212) kept as "-"; `span` covers the sign, an
 * adjacent currency symbol, the numeral, scale words and the unit. A range ("5-10 m", "5 to 10 m",
 * "5~10%") adds `valueEnd` and `range: true`; the unit, and a scale word written only on the second
 * endpoint ("3~5eok"), apply to both endpoints.
 */
export function parseNumeral(text, from = 0) {
	const ranges = excludedRanges(text)
	const found = findStart(text, from, ranges)
	if (!found) return null
	let start = found.at
	const first = scaled(text, found.at + found.length, found.digits)
	let value = first.value
	let end = first.end
	const second = rangeEnd(text, end, ranges)
	if (second) {
		end = second.end
		if (!value && second.factor) value = mul(fromDecimal(found.digits), second.factor)
	}
	let unitRaw = null
	if (start > 0 && CURRENCY.includes(text[start - 1])) [unitRaw, start] = [text[start - 1], start - 1]
	const negative = start > 0 && SIGN.includes(text[start - 1]) && !/[\p{L}\p{N}]/u.test(text[start - 2] ?? "")
	if (negative) start--
	const unit = unitRaw ? null : unitAfter(text, end)
	if (unit) [unitRaw, end] = [unit.unitRaw, unit.end]
	const after = QUALIFIER_AFTER.exec(text.slice(end))
	return {
		value: (negative ? "-" : "") + (value ? toDecimal(value) : found.digits),
		...(second ? { valueEnd: second.value, range: true } : {}),
		raw: text.slice(start, end),
		span: [start, end],
		unitRaw,
		qualifierRaw: qualifierBefore(text, start) ?? (after ? after[1] : null),
	}
}
