// Check displayed conversion originals against their operands, not the mutable render field.
import { sameValue, unitKey } from "./fidelity-binding.mjs"
import { proseText } from "./html-lite.mjs"
import { parseNumeral } from "./numerals.mjs"
import { normalizeText } from "./text-normalize.mjs"
import { display } from "./unit-precision.mjs"
import { dimensionOf } from "./units.mjs"

const DERIVED = new Set(["converted", "derived"])
/**
 * The one bracket grammar of the skill. After NFKC (fullwidth parentheses and square brackets fold
 * to ASCII), an original is a () [] 【】 「」 or 〔〕 group. Inside a derived or converted element every
 * group is an original, never prose; a dash separator is not an original.
 */
const PAIRS = [["(", ")"], ["[", "]"], ["\u3010", "\u3011"], ["\u300C", "\u300D"], ["\u3014", "\u3015"]]
const [OPEN, CLOSE] = [PAIRS.map((pair) => pair[0]).join(""), PAIRS.map((pair) => pair[1]).join("")]
const inClass = (chars) => chars.replace(/[\\\]\[^-]/g, "\\$&")
const literal = (chars) => chars.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const ANY = inClass(OPEN + CLOSE)
const GROUP = new RegExp(PAIRS.map(([open, close]) => `${literal(open)}([^${ANY}]*)${literal(close)}`).join("|"), "gu")
const BRACKET = new RegExp(`[${ANY}]`, "u")
const folded = (text) => String(text).normalize("NFKC")
const innerOf = (match) => match.slice(1).find((part) => part !== undefined)
const mismatch = (message) => ["value_mismatch", message, "original"]

const halfFits = (row, half) => {
	const expected = normalizeText(folded(display(String(row.value), row.unit ?? null)))
	const text = normalizeText(half)
	return text === expected || (text.endsWith(` ${expected}`) && !/\d/.test(text.slice(0, -expected.length)))
}

/** The converted half (the text outside the originals) equals display(row.value, row.unit), rebuilt from the row. */
export function convertedHalfFits(row, shown) {
	if (!DERIVED.has(row.kind) || row.value === null || row.value === undefined) return false
	return halfFits(row, folded(shown).replace(GROUP, ""))
}

/** A second number outside the value verify reads and its originals ("320,000 mm - 999 m"). */
function strayNumber(row, half) {
	if (row.value === null || row.value === undefined || halfFits(row, half)) return null
	const read = parseNumeral(half)
	if (!read || !sameValue(read.value, row.value)) return null
	const rest = half.slice(0, read.span[0]) + half.slice(read.span[1])
	return /\d/.test(row.unit ? rest.split(row.unit).join("") : rest) ? mismatch(`"${half.trim()}" carries a number besides the value and its originals`) : null
}

/** `valueMode`: the element shows the bare value ({{F:x:value}}), so no original is due. */
export function originalProblem(row, shown, rows, valueMode = false) {
	if (!DERIVED.has(row.kind)) return null
	const text = folded(shown)
	const groups = [...text.matchAll(GROUP)]
	const half = text.replace(GROUP, "")
	if (BRACKET.test(half)) return mismatch("original brackets are malformed or nested")
	const operands = (row.derived_from ?? []).map((id) => rows.get(id))
	for (const [index, match] of groups.entries()) {
		const [inner, operand] = [innerOf(match), operands[index]]
		const parsed = parseNumeral(inner)
		if (!operand) return mismatch(`original "${inner}" has no operand of ${row.fact_id}`)
		if (!parsed || !sameValue(parsed.value, operand.value)) return mismatch(`original "${inner}" differs from operand ${operand.fact_id}`)
		if (unitKey(parsed.unitRaw ?? "") !== unitKey(operand.unit ?? "")) return ["unit_mismatch", `original "${inner}" is not in ${operand.unit}`, "original"]
		const expected = normalizeText(folded(display(operand.value, operand.unit ?? null)))
		if (normalizeText(inner) !== expected) return mismatch(`original "${inner}" differs from "${expected}"`)
	}
	if (groups.length > 0 && !/\d/.test(text.slice(0, groups[0].index))) return mismatch(`original "${innerOf(groups[0])}" precedes the value`)
	if (row.kind === "converted" && !valueMode && /\d/.test(half) && groups.length < operands.length) return mismatch(`the original of ${row.derived_from[groups.length]} is missing after the value`)
	return strayNumber(row, half)
}

/** Stands for a filled element or another fill-map value in the text after a fill site. */
const FILLED = "\uFFFC"
/** After a fill site the grammar also reads the brackets an element never carries as originals. */
const FOLLOW = [...PAIRS, ["\u300E", "\u300F"], ["\u300A", "\u300B"], ["\u3008", "\u3009"], ["\u27E8", "\u27E9"]]
const dimension = (unit) => dimensionOf(String(unit).replace(/-e\d+$/u, "")) ?? unitKey(unit)

/** What the text after a fill site opens: a bracket group's content, or the clause after a separator (`open`); else null. */
function openedGroup(text) {
	const rest = folded(text).trimStart()
	const pair = FOLLOW.find(([open]) => rest.startsWith(open))
	const close = pair ? rest.indexOf(pair[1], 1) : -1
	if (pair) return { group: rest.slice(1, close === -1 ? undefined : close).trim(), open: false }
	return /^[-\u2013\u2014/]/u.test(rest) ? { group: rest.slice(1).split(/[,;:!?)\]]|\.(?!\d)/u)[0].trim(), open: true } : null
}

/**
 * Whether the text right after a fill site of `row` opens another original: a bracket group or a
 * separator clause that is exactly a numeral with a unit of the row's or an operand's dimension (a
 * separator clause may end in a glued particle, as Korean writes "- 999 m\uC774\uB2E4").
 * A filled element, a fill-map value (`fills`), a placeholder, a unitless number (a year, a
 * footnote) and prose with digits are not originals; untraceable_number still reads a stray number.
 */
export const followsOriginal = (row, rows, fills = []) => (text) => {
	if (!DERIVED.has(row?.kind)) return false
	const after = [...fills].filter(Boolean).sort((a, b) => b.length - a.length).reduce((cur, fill) => cur.split(fill).join(FILLED), String(text))
	const { group, open } = openedGroup(after) ?? { group: "" }
	if (!group || group.includes(FILLED) || group.includes("{{")) return false
	const units = [row.unit, ...(row.derived_from ?? []).map((id) => rows.get(id)?.unit)].filter(Boolean)
	return [group, ...(open ? [group.replace(/[\uAC00-\uD7A3]+$/u, "").trim()] : [])].some((body) => {
		const read = parseNumeral(body, 0)
		return Boolean(read?.unitRaw) && read.span[0] === 0 && read.span[1] === body.length && units.some((unit) => dimension(unit) === dimension(read.unitRaw))
	})
}

/** The prose after `node` in its parent, each filled element (data-fact) read as one FILLED mark. */
export const textAfter = (node) => {
	const siblings = node.parent?.children.slice(node.parent.children.indexOf(node) + 1) ?? []
	return proseText({ children: siblings.map((child) => (child.attrs?.["data-fact"] === undefined ? child : { tag: "#text", text: FILLED })) })
}

const SPACE = "[\\s\\u3000]"
const DIGIT = "[0-9\\uFF10-\\uFF19]"
/** Each character with the fullwidth form NFKC folds onto it. */
const wide = (chars) => [...chars].map((ch) => ch + (/[!-~]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) + 0xfee0) : "")).join("")
const [WIDE_OPEN, WIDE_CLOSE] = [inClass(wide(OPEN)), inClass(wide(CLOSE))]

/** A pattern reading `rendered` modulo the bracket grammar: NFKC fullwidth forms, bracket style, spacing around brackets. */
function renderPattern(rendered) {
	const text = folded(rendered).trim()
	let body = ""
	for (let at = 0; at < text.length; at += 1) {
		const ch = text[at]
		const beside = (OPEN + CLOSE).includes(text.slice(at).trimStart()[0]) || OPEN.includes(text[at - 1])
		if (/\s/.test(ch)) body += beside ? "" : `${SPACE}+`
		else if (OPEN.includes(ch)) body += `${SPACE}*([${WIDE_OPEN}])${SPACE}*`
		else if (CLOSE.includes(ch)) body += `${SPACE}*([${WIDE_CLOSE}])`
		else body += `[${inClass(wide(ch))}]`
	}
	// A digit may not run into a render's leading or trailing digit ("1,320 m" holds no "320 m"); a bracket ends the render.
	return new RegExp(`${/^\d/.test(text) ? `(?<!${DIGIT})` : ""}${body}${/\d$/.test(text) ? `(?!${DIGIT})` : ""}`, "gu")
}

const pairIndex = (ch, side) => [...side].findIndex((open) => open === folded(ch))
/** [start, end) of `rendered` in `text` from `from` under the bracket grammar, not followed by another original (`follows`); or null. */
export function findRender(text, rendered, from = 0, follows = () => false) {
	const pattern = renderPattern(rendered)
	pattern.lastIndex = from
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		const marks = match.slice(1)
		const paired = marks.every((mark, i) => i % 2 === 1 || pairIndex(mark, OPEN) === pairIndex(marks[i + 1] ?? "", CLOSE))
		const end = match.index + match[0].length
		if (paired && !follows(text.slice(end))) return [match.index, end]
		pattern.lastIndex = match.index + 1
	}
	return null
}

/** Where a stale fill-map entry's text sits: derived and converted renders are read under the bracket grammar. */
export const renderLocator = (rows, fillMap) => (entry, text, from) => {
	const row = rows.get(entry.fact_id)
	if (DERIVED.has(row?.kind)) return findRender(text, entry.rendered, from, followsOriginal(row, rows, (fillMap ?? []).map((other) => other.rendered)))
	const hit = text.indexOf(entry.rendered, from)
	return hit === -1 ? null : [hit, hit + entry.rendered.length]
}

/** Null when a stale derived render is still in the report; "original" when only its converted half is; "gone" otherwise. */
export function staleRender(row, rendered, text, follows) {
	if (findRender(text, rendered, 0, follows) !== null) return null
	const half = folded(rendered).replace(GROUP, "").trim()
	return half !== "" && /\d/.test(half) && findRender(text, half) !== null ? "original" : "gone"
}

export const isDerivedRow = (row) => DERIVED.has(row?.kind)
