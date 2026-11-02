// Value-mode units live outside the fact element. The documented form is the value then its unit,
// with or without a space, a Korean particle allowed after it ({{F1:span:value}} m, {{F3:rate:value}}%,
// {{F21:rev:value}}\uC5B5 \uC6D0\uC73C\uB85C); a currency sign right before the value; the :unit element
// right after it; or the same visual column's table header. A currency the element's own text carries (fill renders a
// prefix currency value from its raw text, $<data>$12</data>) binds too: every bound sign, outside or inside, must agree. Unknown words are advisory, never guessed units,
// unless fill recorded a bound unit for the value: then losing it is a unit edit.
import { cellsOf, rowsOf } from "./fact-locate.mjs"
import { unitKey } from "./fidelity-binding.mjs"
import { parseHtml, proseText } from "./html-lite.mjs"
import { NUMBER_SOURCE } from "./number-grammar.mjs"
import { QUALIFIERS_AFTER } from "./numerals.mjs"
import { dimensionOf, normalizeUnit, spacedAliasUnit } from "./units.mjs"

// Korean particles a unit may carry (eun/neun, i/ga, eul/reul, ui, e, eseo, ege, euro/ro, wa/gwa, do, man,
// kkaji, buteo, boda, ssik, in, ida/yeotda/ieotda, imyeo, igo), longest first.
const PARTICLES = ["\uC774\uC5C8\uB2E4", "\uC600\uB2E4", "\uC774\uB2E4", "\uC774\uBA70", "\uC774\uACE0", "\uC73C\uB85C", "\uC5D0\uC11C", "\uC5D0\uAC8C", "\uAE4C\uC9C0", "\uBD80\uD130", "\uBCF4\uB2E4", "\uC740", "\uB294", "\uC774", "\uAC00", "\uC744", "\uB97C", "\uC758", "\uC5D0", "\uB85C", "\uC640", "\uACFC", "\uB3C4", "\uB9CC", "\uC529", "\uC778"]
/** The displayed value, read with the one grouped-number grammar; text around it is sign and unit. */
const NUMBER = new RegExp(NUMBER_SOURCE, "u")
const SIGNS = ["US$", "$", "\u20AC", "\u20A9", "\u00A3", "\u00A5", "USD", "EUR", "GBP", "JPY", "KRW"]

const withoutSuffix = (word, suffixes) => {
	const suffix = suffixes.find((cur) => word.endsWith(cur) && word.length > cur.length)
	return suffix ? word.slice(0, -suffix.length) : word
}
const withoutParticle = (word) => withoutSuffix(word, PARTICLES)
/** Words written after a value that bound or soften it (the numeral qualifiers, jeongdo, garyang, jjeum, gwaban). */
const QUALIFIER_WORDS = [...QUALIFIERS_AFTER, "\uC815\uB3C4", "\uAC00\uB7C9", "\uCBE4", "\uACFC\uBC18"]
/** A unit, with a particle and/or a qualifier glued on ("m\uC774\uC0C1\uC758"); a whole qualifier word is never a unit (chogwa is not cho + gwa). */
const stemsOf = (word) => {
	const bare = withoutParticle(word)
	return QUALIFIER_WORDS.includes(word) ? [] : [word, bare, withoutSuffix(word, QUALIFIER_WORDS), withoutSuffix(bare, QUALIFIER_WORDS)].filter((stem) => !QUALIFIER_WORDS.includes(stem))
}
const stemOf = (word) => stemsOf(word).find((stem) => normalizeUnit(stem)) ?? null
const unitOf = (word) => normalizeUnit(stemOf(word))
/** Unit aliases that are also ordinary English words ("won awards", "second place"): read only as the row's own unit. */
const ORDINARY_WORDS = new Set(["won", "second", "pound", "pounds"])
/** An ordinary word, or an all-caps acronym that only matches a unit case-insensitively ("SEC filings", "WON"). */
const ordinary = (word) => ORDINARY_WORDS.has(word.toLowerCase()) || (/^[A-Z]{3,}$/.test(word) && normalizeUnit(word) !== word)
/** Inline elements the text after a value is read through; any other element, or another fact, ends it. */
const INLINE = new Set(["a", "abbr", "b", "bdi", "cite", "code", "data", "dfn", "em", "i", "ins", "kbd", "mark", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var"])
/** "3 bun-ui 1" is the fraction one third, not 3 minutes. */
const FRACTION = /^\uBD84\uC758\s?\d/u
const scaleOf = (unit) => /-(e\d+)$/.exec(unit ?? "")?.[1] ?? null

/** English words stay apart: letter-only words join only as a spaced alias ("percentage points"), so "m in" is m, then in. */
const LETTERS = /^[A-Za-z]+$/u
/** The unit the words spell together: a spaced alias, or (with a symbol or Hangul in them) the words joined ("% p", "\uD37C\uC13C\uD2B8 \uD3EC\uC778\uD2B8"). */
function unitOfWords(words) {
	if (words.length === 1) return unitOf(words[0])
	const spaced = stemsOf(words.at(-1)).map((last) => spacedAliasUnit([...words.slice(0, -1), last].join(" "))).find(Boolean)
	return spaced ?? (words.every((word) => LETTERS.test(word)) ? null : unitOf(words.join("")))
}

/** The unit written right after the value: the longest known unit its first words spell ("% \uD3EC\uC778\uD2B8" is %p, not %), else the next word. */
function unitAfter(text, row) {
	const lead = text.replace(/^[\s\u00A0]+/u, "")
	if (FRACTION.test(lead)) return null
	const bracketed = /^\(([^()]{1,40})\)/u.exec(lead)
	if (bracketed) return unitAfter(bracketed[1], row)
	const clause = lead.split(/[,.;:!?()[\]"]/u)[0]
	const words = clause.split(/[\s\u00A0]+/u).filter(Boolean).slice(0, 3)
	if (words.length === 0) return null
	for (let n = words.length; n > 1; n--) {
		const unit = unitOfWords(words.slice(0, n))
		if (unit) return { token: unit }
	}
	const first = unitOf(words[0])
	if (!first) return null
	// An ordinary word ("pounds", "won awards") counts only as the row's unit or beside a sign or header of its kind (boundUnits).
	if (unitKey(first) !== unitKey(row.unit) && ordinary(stemOf(words[0]))) return { token: first, ordinary: true }
	const currency = words[1] ? unitOf(words[1]) : null
	if (dimensionOf(first) === "scale" && dimensionOf(currency)?.startsWith("currency:")) return { token: `${currency} ${words[0]}`, dimension: dimensionOf(currency), scale: first }
	return { token: first }
}

function signBefore(text) {
	const trimmed = text.replace(/[\s\u00A0]+$/u, "")
	// A letter sign is a whole word: "USD 12", never "XUSD 12".
	const sign = SIGNS.find((s) => trimmed.endsWith(s) && !(/^[A-Z]/u.test(s) && /[A-Za-z]$/u.test(trimmed.slice(0, -s.length))))
	return sign ? { token: normalizeUnit(sign), sign: true } : null
}

/** A currency written after the number inside the element ("12\u20AC", "12\uC6D0"); any other unit there is part of the value. */
function currencyAfter(text, row) {
	const found = unitAfter(text, row)
	const dimension = found && !found.ordinary ? (found.dimension ?? dimensionOf(found.token)) : null
	return dimension?.startsWith("currency:") ? { token: found.scale ? dimension.slice("currency:".length) : found.token, sign: true } : null
}

function agrees(found, row) {
	if (found.scale) return dimensionOf(row.unit) === found.dimension && scaleOf(row.unit) === found.scale
	if (unitKey(found.token) === unitKey(row.unit)) return true
	if (dimensionOf(found.token) === "scale") return scaleOf(row.unit) === found.token
	if (dimensionOf(found.token)?.startsWith("currency:") && found.sign) return dimensionOf(row.unit) === dimensionOf(found.token)
	return unitKey(found.token) === unitKey(row.unit)
}

const closest = (node, test) => {
	for (let cur = node.parent; cur; cur = cur.parent) if (test(cur)) return cur
	return null
}
/** All text under a node, code included: a unit may be set in code ("320 <code>ms</code>"). */
const plainText = (node) => (node.tag === "#text" ? node.text : node.children.map(plainText).join(""))

/** A column-header row: a thead row or a row made only of th cells. A th first in a body row is a row header. */
const isHeaderRow = (row) => row.parent?.tag === "thead" || (cellsOf(row).length > 0 && cellsOf(row).every((cur) => cur.tag === "th"))

/** The header of the cell's visual column; nothing binds in a table with a rowspan or without a header row. */
function headerUnit(node) {
	const cell = closest(node, (cur) => cur.tag === "td")
	const table = cell && closest(cell, (cur) => cur.tag === "table")
	if (!table || cell.attrs.colspan || cell.attrs.rowspan) return null
	const rows = rowsOf(table)
	if (rows.some((row) => row.children.some((cur) => cur.attrs?.rowspan && cur.attrs.rowspan !== "1"))) return null
	const header = rows.find(isHeaderRow)
	if (!header || header === cell.parent) return null
	const head = cellsOf(header)[cellsOf(cell.parent).indexOf(cell)]
	if (!head) return null
	const text = proseText(head)
	const label = (/\(([^()]+)\)\s*$/u.exec(text)?.[1] ?? text).trim()
	const unit = unitOf(label) ?? unitOf(label.split(/\s+/u).at(-1) ?? "")
	return unit ? { token: unit } : null
}

/** The documented split form: the next element is this fact's own :unit element. */
function unitElementAfter(siblings, at, row) {
	const next = siblings.slice(at + 1).find((cur) => !(cur.tag === "#text" && !cur.text.trim()))
	return next?.attrs?.["data-fact"] === row.fact_id && unitKey(proseText(next)) === unitKey(row.unit)
}

/** The text after the element within its block, read through inline wrappers and line breaks ("320 <b>m</b>", "<b>320</b> m", "320<br>m"). */
function textAfter(node) {
	let text = ""
	for (let cur = node; text.length < 80; ) {
		const next = cur.parent?.children[cur.parent.children.indexOf(cur) + 1]
		if (next === undefined) {
			if (!INLINE.has(cur.parent?.tag) || cur.parent.attrs["data-fact"] !== undefined) break
			cur = cur.parent
		} else if (next.tag === "#text" || next.tag === "br" || (INLINE.has(next.tag) && next.attrs["data-fact"] === undefined)) {
			text += next.tag === "br" ? "\n" : plainText(next)
			cur = next
		} else break
	}
	return text
}

const INSIDE = "written inside with"
/**
 * Every unit bound to a value-mode element: a currency sign before it, the unit after it (or its :unit element), its
 * column header, and a currency sign or word inside it (prefix or suffix of the number).
 */
function boundUnits(node, row) {
	const siblings = node.parent.children
	const at = siblings.indexOf(node)
	const prev = siblings[at - 1]
	const shown = proseText(node)
	const number = NUMBER.exec(shown)
	const before = signBefore(prev?.tag === "#text" ? prev.text : "")
	// The element's own text is the row's render: a scale word in it ("3,234\uC5B5", "12 million") is part of the value.
	const inside = number ? [signBefore(shown.slice(0, number.index)), currencyAfter(shown.slice(number.index + number[0].length), row)] : []
	const read = unitAfter(textAfter(node), row) ?? (unitElementAfter(siblings, at, row) ? { token: row.unit } : null)
	const header = headerUnit(node)
	const kind = (unit) => dimensionOf(unit.token)?.split(":")[0]
	const after = read?.ordinary && ![before, ...inside, header].some((unit) => unit && kind(unit) === kind(read)) ? null : read
	return [["preceded by", before], ["followed by", after], ["headed with", header], ...inside.map((unit) => [INSIDE, unit])].filter(([, unit]) => unit)
}

/** Each data-fact element's own fill-map entry: fill writes one element per entry, so ids pair up in document order. */
export function fillEntriesByNode(nodes, entries) {
	const queues = new Map()
	for (const entry of entries ?? []) if (entry.replaced === undefined && entry.translates === undefined) queues.set(entry.fact_id, [...(queues.get(entry.fact_id) ?? []), entry])
	return new Map(nodes.filter((node) => node.attrs["data-replaced"] === undefined).flatMap((node) => {
		const entry = queues.get(node.attrs["data-fact"])?.shift()
		return entry ? [[node, entry]] : []
	}))
}

/** Fill's record of the unit bound to each value-mode pointer (unit_bound), read off the filled edition (HTML, or the Markdown projection). */
export function withBoundUnits(html, entries, rows) {
	const all = (node) => [node, ...node.children.flatMap(all)]
	const filled = fillEntriesByNode(all(parseHtml(html)).filter((node) => node.attrs?.["data-fact"] !== undefined), entries)
	const units = new Map([...filled].flatMap(([node, entry]) => {
		const row = rows.get(entry.fact_id)
		// Only a unit outside the element: the element's own text is the row's render, so it can be no record of a unit beside it.
		const unit = entry.mode === "value" && row && unitKey(row.unit) ? boundUnits(node, row).find(([where]) => where !== INSIDE)?.[1].token : null
		return unit ? [[entry, unit]] : []
	}))
	return entries.map((entry) => (units.has(entry) ? { ...entry, unit_bound: units.get(entry) } : entry))
}

/**
 * Value mode comes from fill: the element's data-fact-mode, or its fill-map entry when the edition has one
 * (so deleting the attribute changes nothing). `entry.unit_bound` is the unit fill saw bound to the value.
 */
export function valueUnitProblem(node, row, entry = null) {
	if ((entry?.mode !== "value" && node.attrs["data-fact-mode"] !== "value") || !unitKey(row.unit)) return null
	const found = boundUnits(node, row)
	if (entry?.unit_bound && found.every(([where]) => where === INSIDE)) return ["unit_mismatch", `value-mode ${row.fact_id} had the unit "${entry.unit_bound}" beside it when filled, but no recognizable unit is bound beside it now; its row is in "${row.unit}"`]
	if (found.length === 0) return ["unit_unbound", `${row.fact_id} has unit "${row.unit}" but no recognizable unit right after its value, before it as a currency sign, or in its column header`]
	const wrong = found.find(([, unit]) => !agrees(unit, row))
	return wrong ? ["unit_mismatch", `value-mode ${row.fact_id} is ${wrong[0]} "${wrong[1].token}", but its row is in "${row.unit}"`] : null
}
