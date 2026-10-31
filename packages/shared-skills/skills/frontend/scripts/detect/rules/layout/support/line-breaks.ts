import { descendants, fontSizePx, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot, Rect } from "../../../types"
import { bottom, chain, length, painted, right, textLines } from "./geometry"

function authoredBreak(s: PageSnapshot, el: ElementSnapshot): boolean {
	if (/^(pre|pre-wrap|pre-line|break-spaces)$/.test(styleOf(el, "white-space"))) return true
	return [...descendants(s, el)].some((n) => n.tag === "br" || !["inline", "contents", "none"].includes(styleOf(n, "display")))
}

export function measuredLines(s: PageSnapshot, el: ElementSnapshot): readonly Rect[] {
	if (!painted(s, el) || authoredBreak(s, el)) return []
	const lines = textLines(s, el)
	const widest = [...lines].sort((a, b) => b.width - a.width)[0]
	if (!widest || lines.some((r) => right(r) <= widest.x || r.x >= right(widest))) return []
	for (const c of chain(s, el).slice(0, 5)) {
		if (/^(hidden|clip)$/.test(styleOf(c, "overflow-y")) &&
			lines.some((r) => r.y + r.height / 2 > bottom(c.rect) - length(c, "border-bottom-width"))) return []
	}
	return lines
}

export const wrapIs = (el: ElementSnapshot, value: string): boolean =>
	(styleOf(el, "text-wrap-style") || styleOf(el, "text-wrap")).split(/\s+/).includes(value)

export const wordsOf = (el: ElementSnapshot): readonly string[] =>
	el.text.replace(/[\u00ad\u200b]/g, "").trim().split(/\s+/).filter(Boolean)

export function oneFace(s: PageSnapshot, el: ElementSnapshot): boolean {
	return [...descendants(s, el)].every((n) =>
		!["img", "svg", "canvas", "video", "input"].includes(n.tag) &&
		(styleOf(n, "font-family") === styleOf(el, "font-family") && fontSizePx(n) === fontSizePx(el) || n.ownText === ""))
}
