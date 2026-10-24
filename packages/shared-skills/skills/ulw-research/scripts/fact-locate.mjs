// fact-locate.mjs - deterministic fact locators over a source snapshot.
//
// Each locator returns { value, unit, raw, quote, value_span, sentence_id, qualifier, locator } or
// { error: "fact_not_located" | "fact_ambiguous", candidates }; it never guesses. `quote` is the
// whole containing sentence, cell, or line of text.txt, `value_span` is [start, end] inside
// `quote` with quote.slice(...value_span) === raw, and locator.char_start/char_end place `quote`
// in text.txt. Every call takes `sourceId` (S<n>) so sentence ids match sentences.jsonl.
// Plain Node ESM, sibling imports only; no network, no OCR.

import { proseText } from "./html-lite.mjs"
import { QUALIFIERS } from "./lexicon.mjs"
import { parseNumeral } from "./numerals.mjs"
import { indexSentences, snapshotBlocks } from "./source-snapshot.mjs"
import { findNormalized, normalizeText, tokenize } from "./text-normalize.mjs"
import { similarity } from "./text-similarity.mjs"
import { normalizeUnit } from "./units.mjs"

const FIND_WINDOW = 80
const CONTEXT = 60
const FUZZY_FLOOR = 0.95
const PHRASES = QUALIFIERS.map((phrase) => phrase.split(" "))
const SINGLE_QUALIFIERS = new Set(QUALIFIERS.filter((phrase) => !phrase.includes(" ")))

const notLocated = (candidates = []) => ({ error: "fact_not_located", candidates })
const ambiguous = (candidates) => ({ error: "fact_ambiguous", candidates })
const label = (text) => normalizeText(text).toLowerCase()
const clean = (token) => token.replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, "").toLowerCase()
const sentenceAt = (sentences, offset) => sentences.find((row) => row.start <= offset && offset < row.end) ?? null

function requireSource(sourceId) {
	if (!/^S[1-9]\d*$/.test(String(sourceId))) throw new TypeError(`sourceId must be S<n>, got ${sourceId}`)
}

/** Every normalized occurrence of `needle`, as raw [start, end) offsets. */
function findAll(text, needle) {
	const hits = []
	for (let from = 0; from < text.length; ) {
		const hit = findNormalized(text.slice(from), needle)
		if (!hit) break
		hits.push({ start: from + hit.start, end: from + hit.end })
		from += hit.start + 1
	}
	return hits
}

function locatorFor(text, sourceId, start, end, extra = {}) {
	const before = text.slice(0, start)
	const pageStart = before.lastIndexOf("\f") + 1
	const page = text.includes("\f") ? { page: before.split("\f").length } : {}
	return { artifact: `${sourceId}/text.txt`, ...page, line: before.slice(pageStart).split("\n").length, char_start: start, char_end: end, ...extra }
}

function candidate(text, sentences, start, end) {
	return { sentence_id: sentenceAt(sentences, start)?.sid ?? null, char_start: start, char_end: end, context: text.slice(Math.max(0, start - CONTEXT), end + CONTEXT) }
}

/** A QUALIFIERS token ending within the 2 tokens before the value, or the 1 token right after it. */
function qualifierAround(quote, [start, end]) {
	const before = quote.slice(0, start).split(/\s+/).filter(Boolean).map(clean)
	for (let skip = 0; skip < 2; skip++) {
		for (const words of PHRASES) {
			const stop = before.length - skip
			if (stop - words.length >= 0 && before.slice(stop - words.length, stop).join(" ") === words.join(" ")) return words.join(" ")
		}
	}
	const next = /^\s*(\S+)/.exec(quote.slice(end))
	return next && SINGLE_QUALIFIERS.has(clean(next[1])) ? clean(next[1]) : null
}

/** A located quantity: `holder` is the quote's { sid, start, end, text }, `numeral` is parsed from holder.text. */
function quantityResult(text, sourceId, holder, numeral, extra = {}, unitFallback = null) {
	const unit = numeral.unitRaw ? (normalizeUnit(numeral.unitRaw) ?? numeral.unitRaw) : unitFallback
	return {
		value: numeral.value,
		unit,
		raw: numeral.raw,
		quote: holder.text,
		value_span: [numeral.span[0], numeral.span[1]],
		sentence_id: holder.sid,
		qualifier: qualifierAround(holder.text, numeral.span),
		locator: locatorFor(text, sourceId, holder.start, holder.end, extra),
	}
}

/** --find: one anchor occurrence, then the first numeral starting within 80 chars after it in the same sentence. */
export function locateFind(text, { find, unitExpected, sourceId }) {
	requireSource(sourceId)
	const sentences = indexSentences(text, sourceId)
	const hits = findAll(text, find)
	if (hits.length === 0) return notLocated()
	if (hits.length > 1) return ambiguous(hits.map((hit) => candidate(text, sentences, hit.start, hit.end)))
	const [hit] = hits
	const sentence = sentenceAt(sentences, hit.start)
	if (!sentence || hit.end > sentence.end) return notLocated()
	const from = hit.end - sentence.start
	const numeral = parseNumeral(sentence.text, from)
	if (!numeral || numeral.span[0] - from > FIND_WINDOW) return notLocated([candidate(text, sentences, hit.start, hit.end)])
	const result = quantityResult(text, sourceId, sentence, numeral)
	if (unitExpected === undefined) return result
	const expected = normalizeUnit(unitExpected) ?? unitExpected
	return result.unit === expected ? result : { error: "unit_expected_mismatch", expected, found: result.unit, candidates: [result] }
}

function cellsOf(row) {
	const cells = []
	for (const cell of row.children.filter((child) => child.tag === "td" || child.tag === "th")) {
		const span = Math.max(1, Number.parseInt(cell.attrs.colspan ?? "1", 10) || 1)
		for (let k = 0; k < span; k++) cells.push(cell)
	}
	return cells
}

function rowsOf(table) {
	const rows = []
	const walk = (node) => {
		for (const child of node.children) {
			if (child.tag === "tr") rows.push(child)
			else if (child.tag !== "table" && child.tag !== "#text") walk(child)
		}
	}
	walk(table)
	return rows
}

function tablesOf(root) {
	const tables = []
	const walk = (node) => {
		for (const child of node.children) {
			if (child.tag === "table") tables.push(child)
			if (child.tag !== "#text") walk(child)
		}
	}
	walk(root)
	return tables.map((table) => {
		const rows = rowsOf(table)
		const header = rows.find((row) => row.children.some((child) => child.tag === "th")) ?? rows[0]
		const caption = table.children.find((child) => child.tag === "caption")
		return { table, header, rows: rows.filter((row) => row !== header), caption: caption ? label(proseText(caption)) : null }
	})
}

const cellLabel = (cell) => label(proseText(cell))
const indexesOf = (labels, wanted) => labels.flatMap((value, index) => (value === wanted ? [index] : []))

/** --table/--row/--col: the table by id, caption, or a header label; row and column by normalized label, never by index. */
export function locateTable(sourceHtml, { table, row, col, sourceId }) {
	requireSource(sourceId)
	const { root, text, blocks } = snapshotBlocks(sourceHtml)
	const key = label(table)
	const tables = tablesOf(root).filter((entry) => entry.table.attrs.id === table || entry.caption === key || (entry.header && cellsOf(entry.header).map(cellLabel).includes(key)))
	if (tables.length !== 1) return tables.length === 0 ? notLocated() : ambiguous(tables.map((entry) => ({ table: entry.table.attrs.id ?? entry.caption })))
	const [{ header, rows }] = tables
	const headerCells = header ? cellsOf(header) : []
	const columns = indexesOf(headerCells.map(cellLabel), label(col))
	const matches = rows.filter((candidateRow) => cellsOf(candidateRow).length > 0 && cellLabel(cellsOf(candidateRow)[0]) === label(row))
	if (columns.length > 1 || matches.length > 1) return ambiguous([...columns.map((index) => ({ col: index })), ...matches.map((match) => ({ row_line: match.line }))])
	const cell = columns.length === 1 && matches.length === 1 ? cellsOf(matches[0])[columns[0]] : null
	const block = cell ? blocks.find((entry) => entry.node === cell) : null
	if (!block) return notLocated()
	const holder = { sid: sentenceAt(indexSentences(text, sourceId), block.start)?.sid ?? null, start: block.start, end: block.end, text: text.slice(block.start, block.end) }
	const numeral = parseNumeral(holder.text)
	if (!numeral) return notLocated()
	const headerUnit = /\(([^()]+)\)\s*$/.exec(cellLabel(headerCells[columns[0]]))
	return quantityResult(text, sourceId, holder, numeral, { table, row_label: row, col_label: col }, headerUnit ? normalizeUnit(headerUnit[1]) : null)
}

/** --page/--line: exactly one quantity on that line of that page (pages split on a form feed). */
export function locatePageLine(text, { page, line, sourceId }) {
	requireSource(sourceId)
	const pages = text.split("\f")
	if (!Number.isInteger(page) || page < 1 || page > pages.length) return notLocated()
	const lines = pages[page - 1].split("\n")
	if (!Number.isInteger(line) || line < 1 || line > lines.length) return notLocated()
	let start = pages.slice(0, page - 1).reduce((sum, body) => sum + body.length + 1, 0)
	for (const body of lines.slice(0, line - 1)) start += body.length + 1
	const holder = { start, end: start + lines[line - 1].length, text: lines[line - 1] }
	const numerals = []
	for (let numeral = parseNumeral(holder.text); numeral; numeral = parseNumeral(holder.text, numeral.span[1])) numerals.push(numeral)
	const sentences = indexSentences(text, sourceId)
	if (numerals.length !== 1) return numerals.length === 0 ? notLocated() : ambiguous(numerals.map((numeral) => candidate(text, sentences, start + numeral.span[0], start + numeral.span[1])))
	holder.sid = sentenceAt(sentences, start + numerals[0].span[0])?.sid ?? null
	return quantityResult(text, sourceId, holder, numerals[0])
}

/** Token-aligned windows of `sentence` whose similarity to `match` reaches the fuzzy floor; best first. */
function fuzzyWindow(sentence, match) {
	const target = normalizeText(match).length
	const wanted = new Set(tokenize(match))
	const present = new Set(tokenize(sentence.text))
	if (wanted.size === 0 || [...wanted].filter((token) => present.has(token)).length / wanted.size < 0.5) return null
	const bounds = [...sentence.text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => [m.index, m.index + m[0].length])
	let best = null
	for (let i = 0; i < bounds.length; i++) {
		for (let j = i; j < bounds.length; j++) {
			const window = sentence.text.slice(bounds[i][0], bounds[j][1])
			if (window.length > target * 1.06 + 2) break
			if (window.length < target * 0.94 - 2) continue
			const score = similarity(window, match)
			if (score >= FUZZY_FLOOR && (!best || score > best.score)) best = { score, start: sentence.start + bounds[i][0], end: sentence.start + bounds[j][1] }
		}
	}
	return best
}

function quoteResult(text, sourceId, sentences, start, end, fuzzy) {
	const first = sentenceAt(sentences, start)
	const last = sentenceAt(sentences, end - 1) ?? first
	return {
		value: null,
		unit: null,
		raw: text.slice(start, end),
		quote: text.slice(first.start, last.end),
		value_span: null,
		sentence_id: first.sid,
		qualifier: null,
		fuzzy,
		locator: locatorFor(text, sourceId, first.start, last.end),
	}
}

/** --match: a normalized exact match (fuzzy false), else the one window with similarity >= 0.95 (fuzzy true). */
export function locateMatch(text, { match, sourceId }) {
	requireSource(sourceId)
	const sentences = indexSentences(text, sourceId)
	const hits = findAll(text, match)
	if (hits.length > 1) return ambiguous(hits.map((hit) => candidate(text, sentences, hit.start, hit.end)))
	if (hits.length === 1) return quoteResult(text, sourceId, sentences, hits[0].start, hits[0].end, false)
	const windows = sentences.map((sentence) => fuzzyWindow(sentence, match)).filter(Boolean)
	if (windows.length > 1) return ambiguous(windows.map((window) => candidate(text, sentences, window.start, window.end)))
	return windows.length === 1 ? quoteResult(text, sourceId, sentences, windows[0].start, windows[0].end, true) : notLocated()
}
