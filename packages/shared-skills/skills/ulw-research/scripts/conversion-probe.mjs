// conversion-probe.mjs - numeric multiset differences after source conversion.
// Inline markup may split one number; superscripts must not merge into it. Numbers are read with the
// one grouped-number grammar (number-grammar.mjs). A cell, row, list-item, block or line break is a
// hard boundary: a space never groups digits across it. A sign counts when no Latin, Greek or
// Cyrillic letter, digit or underscore touches it (an en dash before a digit is a minus too), and a
// "-" or U+2212 counts after ONE such letter ("\u0394\u22125") or after an exponent ("1e-5"); a run of
// two or more ("cite_note-7", "AB-12", "UTF-8", "2019-2023") is an identifier or range and carries no
// negative. Markdown markup a converter writes beside a sign never decides it: the closer run before it
// (read with the CommonMark inline grammar in markdown-closers.mjs: emphasis, code, strike, titled and
// parenthesised link and image targets, reference endings, backslash-escaped closers) is skipped to
// the first character it closes ("**2019**-2023" and '[1990](/wiki/1990 "1990")-2000' are ranges), and
// an opener run between the sign and its digits ("-**5**") keeps the sign. A raw-side character
// reference (`&minus;`, `&thinsp;`) is decoded on BOTH sides with the one entities.mjs table, so a
// verbatim copy probes clean. Raw inline HTML a converter leaves in the Markdown (pandoc's gfm writer
// emits `<sup>`, `<sub>`, `<img ... width=320>`, `<span>`, `<br>`) is read with the html-lite tag
// reader: sup, sub and break tags are boundaries, as on the raw side, and any other tag or comment is
// dropped with its attributes, so it is a closer or opener like Markdown markup. Digits a converter
// writes out from a link target, an image source, alt text, or a title cover a converted number only
// inside Markdown link or image syntax (`](...)` with any title and balanced parentheses,
// `![...](...)`, `<https://...>`, `[ref]: url "title"` with the title on the same or the next line),
// never in prose; a footnote
// definition's text ("[^1]: ...") is prose. Converter syntax is not a number: a line-start list marker
// ("1. ", "2) ", "(3) ", indented or after "> ") is exempt only while the source has an <ol> item with
// that number and the markers so far do not outnumber the <ol> items (so lazy "1. 1. 1." numbering
// over three items passes), a numeric reference label ("[x][1]" with its "[1]: url") only while both
// halves are present, and a footnote definition label ("[^1]:") only while its "[^1]" is used;
// otherwise each is a candidate. A converter's hard wrap may split a space-grouped number over one line
// break; the two halves read as one number only when the raw side holds that number and not both
// halves, so raw "12 345 and 12 and 345" wrapped inside "12 345" reports both halves (it fails safe).
// The built-in snapshot writes no attribute text, syntax, wraps or tags, and its text is already
// decoded, so it gets none of these allowances. Constructs outside this grammar are declared out of
// scope in references/fact-ledger.md: they report as altered (the safe direction).

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CliError } from "./cli-support.mjs"
import { decodeEntities, parseHtml, PROSE_BREAKS, readTag } from "./html-lite.mjs"
import { escapedAt, inlineLinkSpans, stripClosers } from "./markdown-closers.mjs"
import { NUMBER_SOURCE, plainDecimal } from "./number-grammar.mjs"

const LETTER = "\\p{Script=Latin}\\p{Script=Greek}\\p{Script=Cyrillic}"
const WORD = new RegExp(`[${LETTER}\\p{N}_]`, "u")
const ALPHA = new RegExp(`[${LETTER}]`, "u")
const EXPONENT = new RegExp(`(?<![${LETTER}\\p{N}_.,])\\d+(?:[.,]\\d+)?[eE]$`, "u")
/** A dash, then any Markdown opener run, then a number; signed() decides whether the dash is a minus. */
const NUMBERS = new RegExp(`(?:([-\\u2212\\u2013])([*_~\`[]*))?(${NUMBER_SOURCE})`, "gu")
/** Sup, sub, datetime chunks and every break join no neighbour: neither a digit, a separator, nor whitespace. */
const BOUNDARY = "\u0001"
const CARRIED = ["href", "src", "alt", "title"]
const LIST_MARKER = /(?:^|\u0001)(?: ?>)* ?(?:\d+[.)]|\(\d+\)) /gu
const REF_USE = /\]\[(\d+)\]/gu
const REF_DEF = /(?:^|\u0001)(?: ?>)* ?\[(\d+)\]:/gu
const NOTE_USE = /\[\^(\d+)\](?!:)/gu
const NOTE_DEF = /(?:^|\u0001)(?: ?>)* ?\[\^(\d+)\]:/gu
const TITLE = `(?:"[^"\u0001]*"|'[^'\u0001]*'|\\([^)\u0001]*\\))`
/** A reference definition's title may sit alone on the next line (only whitespace after it). */
const REF_DEFINITION = `(?:^|\u0001) ?\\[(?!\\^)[^\\]\u0001]+\\]: ?[^\\s\u0001]*(?: ${TITLE}| ?\u0001 ?${TITLE}(?= ?(?:\u0001|$)))?`
const LINK_SYNTAX = new RegExp(`!\\[[^\\]\u0001]*\\](?:\\([^)\u0001]*\\))?|\\]\\([^)\u0001]*\\)|<https?:\\/\\/[^>\\s\u0001]+>|${REF_DEFINITION}`, "gu")
const TAG_NAME = /^[a-z][a-z0-9-]*$/u
/** What a tag leaves in the numeric text on either side: sup, sub and every break join no neighbour. */
const edgeOf = (tag) => (tag === "sup" || tag === "sub" || PROSE_BREAKS.has(tag) ? BOUNDARY : "")

/** Prose text, attribute text and <ol> item numbers of an HTML document; a non-HTML document is prose only. */
function numericText(source, html) {
	if (!html) return { prose: decodeEntities(source), carried: "", listed: [] }
	const chunks = []
	const carried = []
	const listed = []
	const walk = (node) => {
		if (node.tag === "#text") { chunks.push(node.text.replace(/\s+/gu, " ")); return }
		for (const name of CARRIED) if (node.attrs?.[name] !== undefined) carried.push(node.attrs[name])
		if (node.tag === "ol") {
			const start = /^\s*\d+\s*$/u.test(node.attrs.start ?? "") ? Number(node.attrs.start) : 1
			node.children.filter((child) => child.tag === "li").forEach((_, index) => listed.push(String(start + index)))
		}
		const edge = edgeOf(node.tag)
		chunks.push(edge)
		if (node.tag === "time" && node.attrs.datetime !== undefined) chunks.push(`${BOUNDARY}${node.attrs.datetime}${BOUNDARY}`)
		for (const child of node.children) walk(child)
		chunks.push(edge)
	}
	walk(parseHtml(source))
	return { prose: chunks.join(""), carried: carried.join(BOUNDARY), listed }
}

/** Raw inline HTML in converted Markdown: sup, sub and break tags become boundaries, other tags and comments go. */
function inlineHtml(text) {
	let out = ""
	let kept = 0
	for (let lt = text.indexOf("<"); lt !== -1; lt = text.indexOf("<", Math.max(lt + 1, kept))) {
		const comment = text.startsWith("<!--", lt)
		const name = lt + (text[lt + 1] === "/" ? 2 : 1)
		if (escapedAt(text, lt) || (!comment && !/[a-z]/iu.test(text[name] ?? ""))) continue
		const tag = comment ? null : readTag(text, name)
		const end = comment ? text.indexOf("-->", lt + 4) + 3 : tag.end
		if (end <= lt || (tag && !(TAG_NAME.test(tag.name) && text[end - 1] === ">")) || /\n[ \t\r]*\n/u.test(text.slice(lt, end))) continue
		out += text.slice(kept, lt) + (tag ? edgeOf(tag.name) : "")
		kept = end
	}
	return out + text.slice(kept)
}

/**
 * Start offsets of numeric reference labels whose use ("][1]") and definition ("[1]:") are both present,
 * and of footnote definition labels ("[^1]:") whose "[^1]" is used (the use itself mirrors the source).
 */
function referenceLabels(flat) {
	const uses = [...flat.matchAll(REF_USE)]
	const defs = [...flat.matchAll(REF_DEF)]
	const used = new Set(uses.map((match) => match[1]))
	const defined = new Set(defs.map((match) => match[1]))
	const paired = [...uses.filter((match) => defined.has(match[1])), ...defs.filter((match) => used.has(match[1]))]
	const noted = new Set([...flat.matchAll(NOTE_USE)].map((match) => match[1]))
	const notes = [...flat.matchAll(NOTE_DEF)].filter((match) => noted.has(match[1]))
	return new Set([...paired, ...notes].map((match) => match.index + match[0].search(/\d/u)))
}

/** Whether the dash at `at` is a minus: Markdown closers (and a backslash escaping the dash) before it are skipped, as is an opener run before a lone letter. */
function signed(flat, at, dash) {
	const before = stripClosers(flat.slice(Math.max(0, at - 512), escapedAt(flat, at) ? at - 1 : at))
	const last = before.at(-1) ?? ""
	if (!WORD.test(last)) return true
	if (dash === "\u2013") return false
	if (EXPONENT.test(before)) return true
	return ALPHA.test(last) && !WORD.test(before.slice(0, -1).replace(/[*_~`[]+$/u, "").at(-1) ?? "")
}

/**
 * Line breaks become boundaries, then whitespace runs one space; `linked` marks tokens inside link
 * syntax, `marker` a line-start list marker, `label` a paired reference label, `gap` the text since
 * the previous number.
 */
function tokensOf(text, { links = false } = {}) {
	const flat = text.replace(/\r\n?|\n|\f/gu, BOUNDARY).replace(/\s+/gu, " ")
	const spans = links ? [...[...flat.matchAll(LINK_SYNTAX)].map((match) => [match.index, match.index + match[0].length]), ...inlineLinkSpans(flat)] : []
	const markers = new Set([...flat.matchAll(LIST_MARKER)].map((match) => match.index + match[0].search(/\d/u)))
	const labels = referenceLabels(flat)
	let previousEnd = 0
	return [...flat.matchAll(NUMBERS)].map((match, n) => {
		const sign = match[1] !== undefined && signed(flat, match.index, match[1])
		const at = sign ? match.index : match.index + match[0].length - match[3].length
		const gap = flat.slice(previousEnd, at)
		previousEnd = match.index + match[0].length
		return {
			n,
			gap,
			text: sign ? match[0] : match[3],
			key: `${sign ? "-" : ""}${plainDecimal(match[3])}`,
			linked: spans.some(([start, end]) => at >= start && at < end),
			marker: markers.has(at),
			label: labels.has(at),
		}
	})
}

/** The comparison key of one number token, so other tools can match a converted number against a probe record. */
export const numberKey = (token) => tokensOf(String(token))[0]?.key ?? null

/** The numbers in `texts` that the source's conversion probe recorded as altered (sources/<id>/conversion.json). */
export function alteredIn(sourceDir, texts) {
	const record = join(sourceDir, "conversion.json")
	let altered = []
	if (existsSync(record)) {
		try {
			altered = JSON.parse(readFileSync(record, "utf8")).conversion_altered_numbers ?? []
		} catch (error) {
			throw new CliError(`${record} is not a readable conversion record (${error.message}); snapshot the source again`)
		}
	}
	const keys = new Set(altered.map(numberKey))
	return texts.flatMap((text) => tokensOf(String(text ?? ""))).filter((token) => keys.has(token.key)).map((token) => token.text)
}

/** Rejoin a grouped number a hard wrap split over one line break, when only the joined reading is in the raw counts. */
function joinWrapped(tokens, raw) {
	const out = []
	for (const token of tokens) {
		const prev = out.at(-1)
		const wrapped = prev?.n === token.n - 1 && /^ ?\u0001 ?$/u.test(token.gap) && !prev.linked && !token.linked
		const [joined, ...more] = wrapped ? tokensOf(`${prev.text} ${token.text}`) : []
		if (joined && more.length === 0 && raw.has(joined.key) && !(raw.has(prev.key) && raw.has(token.key))) {
			out[out.length - 1] = { ...joined, n: token.n, text: `${prev.text}\n${token.text}` }
			continue
		}
		out.push(token)
	}
	return out
}

const countOf = (tokens) => tokens.reduce((counts, token) => counts.set(token.key, (counts.get(token.key) ?? 0) + 1), new Map())

/** The tokens `counts` cannot cover; each covered token uses up one count. */
function uncovered(tokens, counts) {
	return tokens.filter((token) => {
		const remaining = counts.get(token.key) ?? 0
		if (remaining === 0) return true
		counts.set(token.key, remaining - 1)
		return false
	})
}

/**
 * Preserve token spelling in diagnostics; the raw side is read as HTML, the converted side as Markdown
 * with raw inline tags, both decoded with one entity table. `attributes: false`
 * (the built-in snapshot) gives attribute digits no cover, converter syntax no exemption and no wrap rejoin. An exempt
 * marker or label is not a converted number at all: it neither covers a raw number nor counts as altered.
 */
export function probeConversion(raw, converted, { attributes = true } = {}) {
	const source = numericText(raw, /<[a-z!/]/i.test(raw))
	const before = tokensOf(source.prose)
	const listed = new Set(source.listed)
	let items = attributes ? source.listed.length : 0
	const syntax = tokensOf(attributes ? decodeEntities(inlineHtml(converted)) : converted, { links: attributes })
		.filter((token) => !(attributes && token.label) && !(token.marker && listed.has(token.key) && items-- > 0))
	const after = attributes ? joinWrapped(syntax, countOf(before)) : syntax
	const counts = countOf(before)
	const extra = new Set(uncovered(after.filter((token) => !token.linked), counts))
	for (const token of tokensOf(source.carried)) counts.set(token.key, (counts.get(token.key) ?? 0) + 1)
	for (const token of uncovered(after.filter((token) => token.linked), counts)) extra.add(token)
	const lost = uncovered(before, countOf(after)).map((token) => token.text)
	return { altered: after.filter((token) => extra.has(token)).map((token) => token.text), lost, raw_count: before.length, converted_count: after.length }
}

export function runConversionProbe(argv) {
	if (argv.length !== 2) throw new CliError("usage: source probe-conversion <raw-file> <converted-file>")
	const result = probeConversion(readFileSync(argv[0], "utf8"), readFileSync(argv[1], "utf8"))
	return { json: result, summary: `source probe-conversion: ${result.altered.length} altered, ${result.lost.length} lost`, exitCode: result.altered.length === 0 ? 0 : 1 }
}
