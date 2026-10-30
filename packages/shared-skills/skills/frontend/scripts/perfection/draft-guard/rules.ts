import type { DraftRuleId } from "./findings"
import { type Element, isStatElement, type TextNode } from "./text-nodes"

export type RuleHit = { readonly rule: DraftRuleId; readonly offset: number }

const PROMO_PHRASES = new RegExp(
	[
		String.raw`\bseamless(?:ly)?\b`,
		String.raw`\beffortless(?:ly)?\b`,
		String.raw`\bsupercharge[sd]?\b`,
		String.raw`\bunlock (?:the (?:full )?power|the full potential|your (?:full )?potential)\b`,
		String.raw`\bat a glance\b`,
		String.raw`\bcutting[- ]edge\b`,
		String.raw`\bgame[- ]chang(?:er|ing)\b`,
		String.raw`\brevolutioni[sz]e\b`,
		String.raw`\bnext[- ]level\b`,
		String.raw`\bworld[- ]class\b`,
		String.raw`\belevate your\b`,
		"한눈에",
		"손쉽게",
		"스마트한",
		"혁신적인",
	].join("|"),
	"giu",
)

const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u
const EMOJI_ALL = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F?/gu
const NUMERIC_ENTITY = /&#(?:x([0-9a-f]+)|(\d+));/gi
const BADGE_CLASS = /^(?:badge|chip|pill|tag)(?:$|[-_])/
const BADGE_COMPONENT = /^(?:Badge|Chip|Pill|Tag)$/
const HYPE_LABEL = /^(?:new!?|hot|trending|popular|featured|ai|ai[- ]powered|premium|recommended|best|신규|인기|추천|베스트)$/i
const AMOUNT = String.raw`(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?`
const MARKETING_NUMBER = new RegExp(String.raw`^(?:[$€£¥₩]?${AMOUNT}\s*(?:[kmb]|%)?\s*\+|${AMOUNT}\s*[x×]|24\/7)$`, "i")

const isBadge = (element: Element | undefined): boolean =>
	element !== undefined && !element.stateful && (BADGE_COMPONENT.test(element.name) || element.classes.some((c) => BADGE_CLASS.test(c)))

function leadingOffset(node: TextNode): number {
	return node.offset + (node.text.length - node.text.trimStart().length)
}

function emojiOffset(text: string): number | null {
	const direct = EMOJI.exec(text)
	if (direct) return direct.index
	for (const m of text.matchAll(NUMERIC_ENTITY)) {
		const code = m[1] === undefined ? Number(m[2]) : Number.parseInt(m[1], 16)
		if (Number.isInteger(code) && code <= 0x10ffff && EMOJI.test(String.fromCodePoint(code))) return m.index ?? 0
	}
	return null
}

/** A stat is a vanity number only in marketing form (10x, 500+, $2M+, 24/7); a measured figure such as 42% or 1.2k passes. */
export function checkNode(node: TextNode): RuleHit[] {
	const hits: RuleHit[] = []
	const label = node.text.trim()
	if (node.kind !== "value") {
		for (const m of node.text.matchAll(PROMO_PHRASES)) hits.push({ rule: "promo-copy", offset: node.offset + (m.index ?? 0) })
		const emoji = emojiOffset(node.text)
		if (emoji !== null) hits.push({ rule: "emoji-icon", offset: node.offset + emoji })
	}
	if (node.kind === "text" && isBadge(node.stack.at(-1)) && HYPE_LABEL.test(label.replace(EMOJI_ALL, "").trim())) {
		hits.push({ rule: "decorative-badge", offset: leadingOffset(node) })
	}
	if (node.kind !== "label" && node.stack.some(isStatElement) && MARKETING_NUMBER.test(label)) {
		hits.push({ rule: "vanity-stat", offset: leadingOffset(node) })
	}
	return hits
}
