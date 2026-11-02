// gates-text.mjs - prose gates: G1 keep-all, G3 emoji, G4 dashes, G5/G6 headings, G7 unsourced numbers.
//
// Each gate is { codes, run(ctx) -> Defect[] } over the context built by gates-static.mjs.
// Plain Node ESM, sibling imports only.

import { proseText } from "./html-lite.mjs"
import { CLAIMS, NOT_CLAIMS } from "./numerals.mjs"

const HANGUL = /[\uAC00-\uD7A3]/g
const KEEP_ALL = /word-break\s*:\s*keep-all/i
const MIN_HANGUL = 20
/** Dingbats (2700-27BF) that render as emoji without FE0F (Emoji_Presentation=Yes). */
const DINGBAT_EMOJI = new Set([0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x27b0, 0x27bf])
const EM_DASH = "\u2014"
const EN_DASH = "\u2013"
const HEADING_NUMBER = /^\s*(?:\d+(?:[.-]\d+)*[.):]?|[IVXLC]+[.)]|[A-Z][.)])\s+/
const GENERIC = new Set(["overview", "introduction", "background", "summary", "conclusion", "conclusions", "results", "discussion", "methodology"])
const MAX_HEADING_HANGUL = 26
const MAX_HEADING_WORDS = 12
const LINEAGE_TOKEN = /\b(?:MEASURED|ASSUMED|DERIVED)\b/
const NUMBER_CONTAINERS = new Set(["figure", "table", "nav", "header", "footer"])
const MAX_UNSOURCED = 50

function snippet(text, index, span = 24) {
	return text.slice(Math.max(0, index - span), index + span).trim()
}

/** Concatenated prose per owning element, in document order; `keep` filters text entries. */
function ownerTexts(ctx, keep) {
	const byOwner = new Map()
	for (const entry of ctx.texts) {
		if (!keep(entry)) continue
		byOwner.set(entry.owner, (byOwner.get(entry.owner) ?? "") + entry.node.text)
	}
	return [...byOwner].map(([owner, text]) => ({ owner, text: text.replace(/\s+/g, " ") }))
}

function firstEmoji(text) {
	const chars = [...text]
	for (let i = 0; i < chars.length; i++) {
		const cp = chars[i].codePointAt(0)
		if (chars[i + 1] === "\uFE0F" && cp !== 0xfe0f) return chars[i] + chars[i + 1]
		if ((cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x26ff) || DINGBAT_EMOJI.has(cp)) return chars[i]
	}
	return null
}

const isDigit = (ch) => ch >= "0" && ch <= "9"

/** En dash allowed only when both neighbors (one optional space) are digits. */
function badEnDash(text) {
	for (let at = text.indexOf(EN_DASH); at !== -1; at = text.indexOf(EN_DASH, at + 1)) {
		const before = text[at - 1] === " " ? text[at - 2] : text[at - 1]
		const after = text[at + 1] === " " ? text[at + 2] : text[at + 1]
		if (!isDigit(before ?? "") || !isDigit(after ?? "")) return at
	}
	return -1
}

const stripNumbering = (text) => text.replace(HEADING_NUMBER, "").trim()

function headings(ctx, max) {
	return ctx.elements.filter(({ node }) => /^h[1-6]$/.test(node.tag) && Number(node.tag[1]) <= max).map(({ node }) => node)
}

/** Citation markers need no stripping: an element carrying one is skipped before this runs. */
function claimIn(text) {
	let rest = text
	for (const re of NOT_CLAIMS) rest = rest.replace(re, " ")
	for (const re of CLAIMS) {
		const match = re.exec(rest)
		if (match) return match[0].trim()
	}
	return null
}

function numberCandidates(ctx) {
	const { closest, classTokens, descendants } = ctx.util
	return ctx.elements.filter(({ node, scope }) => {
		if (node.tag !== "p" && node.tag !== "li") return false
		if (node.tag === "li" && descendants(node).some((child) => child.tag === "p" || child.tag === "li")) return false
		const kind = ctx.kindOf(scope)
		if (kind === "closing" || kind === "sources") return false
		return !closest(node, (cur) => NUMBER_CONTAINERS.has(cur.tag) || classTokens(cur).includes("fig"))
	})
}

export const textGates = [
	{
		codes: ["korean_no_keep_all"],
		run(ctx) {
			const syllables = ctx.texts.reduce((sum, entry) => sum + (entry.node.text.match(HANGUL)?.length ?? 0), 0)
			if (syllables < MIN_HANGUL) return []
			if ([...ctx.styleBlocks, ...ctx.styleAttrs].some((entry) => KEEP_ALL.test(entry.css))) return []
			return [ctx.defect("korean_no_keep_all", ctx.body, `${syllables} Hangul syllables in prose and no "word-break: keep-all" in any style block or style attribute`)]
		},
	},
	{
		codes: ["emoji_in_prose"],
		run(ctx) {
			const defects = []
			for (const { owner, text } of ownerTexts(ctx, () => true)) {
				const emoji = firstEmoji(text)
				if (emoji) defects.push(ctx.defect("emoji_in_prose", owner, `emoji "${emoji}" in <${owner.tag}>: "${snippet(text, text.indexOf(emoji))}"`))
			}
			return defects
		},
	},
	{
		codes: ["em_dash_in_prose", "en_dash_in_prose"],
		run(ctx) {
			const defects = []
			const inScope = (entry) => !entry.cell && ctx.kindOf(entry.scope) !== "sources"
			for (const { owner, text } of ownerTexts(ctx, inScope)) {
				const em = text.indexOf(EM_DASH)
				if (em !== -1) defects.push(ctx.defect("em_dash_in_prose", owner, `em dash "${EM_DASH}" in <${owner.tag}>: "${snippet(text, em)}"`))
				const en = badEnDash(text)
				if (en !== -1) defects.push(ctx.defect("en_dash_in_prose", owner, `en dash "${EN_DASH}" outside a numeric range in <${owner.tag}>: "${snippet(text, en)}"`))
			}
			return defects
		},
	},
	{
		codes: ["heading_too_long"],
		run(ctx) {
			const defects = []
			for (const node of headings(ctx, 4)) {
				const text = stripNumbering(proseText(node))
				const hangul = /[\uAC00-\uD7A3]/.test(text)
				const size = hangul ? [...text].length : text.split(/\s+/).filter(Boolean).length
				if (size > (hangul ? MAX_HEADING_HANGUL : MAX_HEADING_WORDS)) {
					defects.push(ctx.defect("heading_too_long", node, `<${node.tag}> "${text}" is ${size} ${hangul ? "characters (> 26)" : "words (> 12)"}`))
				}
			}
			return defects
		},
	},
	{
		codes: ["heading_generic"],
		run(ctx) {
			const defects = []
			for (const node of headings(ctx, 3)) {
				const text = stripNumbering(proseText(node))
				if (GENERIC.has(text.toLowerCase().replace(/[.:]+$/, ""))) defects.push(ctx.defect("heading_generic", node, `generic <${node.tag}> "${text}"`))
			}
			return defects
		},
	},
	{
		codes: ["unsourced_number"],
		run(ctx) {
			const defects = []
			for (const { node } of numberCandidates(ctx)) {
				if (defects.length >= MAX_UNSOURCED) break
				const text = proseText(node)
				if (LINEAGE_TOKEN.test(text) || ctx.util.hasCitation(node)) continue
				if (node.attrs["data-lineage"] !== undefined || ctx.util.descendants(node).some((child) => child.attrs["data-lineage"] !== undefined)) continue
				const claim = claimIn(text)
				if (claim) defects.push(ctx.defect("unsourced_number", node, `number "${claim}" without a lineage tag or citation: "${snippet(text, text.indexOf(claim))}"`))
			}
			return defects
		},
	},
]
