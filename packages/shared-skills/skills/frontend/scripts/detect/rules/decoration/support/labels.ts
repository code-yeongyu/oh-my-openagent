import { ancestors, childrenOf, descendants, fontSizePx, isHeading, parentOf, styleOf } from "../../../core/page"
import { parseColor } from "../../../core/color"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { chroma, context, length, radii, visible } from "./appearance"
function previous(s: PageSnapshot, e: ElementSnapshot): ElementSnapshot | null {
	const p = parentOf(s, e)
	if (!p) return null
	const siblings = childrenOf(s, p),
		at = siblings.findIndex((n) => n.index === e.index)
	return siblings[at - 1] ?? null
}
export function labelBefore(s: PageSnapshot, h: ElementSnapshot): { label: ElementSnapshot; levels: number } | null {
	let at = h
	for (let levels = 0; levels <= 4; levels++) {
		const label = previous(s, at)
		if (label) return { label, levels }
		const p = parentOf(s, at)
		if (!p || ["body", "html"].includes(p.tag)) return null
		at = p
	}
	return null
}
export function labelType(s: PageSnapshot, e: ElementSnapshot): ElementSnapshot {
	let at = e
	for (let i = 0; i < 3; i++) {
		if (at.ownText.trim() !== "") return at
		const children = childrenOf(s, at).filter((c) => c.text.trim() !== "")
		const only = children[0]
		if (children.length !== 1 || !only) return at
		at = only
	}
	return at
}
export const application = (s: PageSnapshot, e: ElementSnapshot): boolean =>
	context(s, e, (a) => a.tag === "dialog" || ["tabpanel", "dialog", "application"].includes(a.attributes["role"] ?? ""))
export const caps = (e: ElementSnapshot): boolean =>
	styleOf(e, "text-transform") === "uppercase" || (/[A-Z]/.test(e.text) && !/[a-z]/.test(e.text))
export function heroLabel(s: PageSnapshot, h: ElementSnapshot): ElementSnapshot | null {
	if (h.tag !== "h1" || fontSizePx(h) < 48 || application(s, h) || !visible(s, h)) return null
	const e = previous(s, h)
	if (!e || isHeading(e) || e.text.trim().length < 2 || e.text.trim().length > 60 || !visible(s, e)) return null
	const ty = labelType(s, e),
		size = fontSizePx(ty),
		spacing = length(styleOf(ty, "letter-spacing"))
	if (size <= 0 || size > 14) return null
	const dated =
		(e.tag === "time" || [...descendants(s, e)].some((c) => c.tag === "time") || /\b(?:19|20)\d{2}\b/.test(e.text)) && spacing < 1.6
	const tracked = caps(ty) && !dated && (spacing >= 1.6 || spacing >= size * 0.08)
	const bold = Number(styleOf(ty, "font-weight")) >= 700 && chroma(styleOf(ty, "color"), 40)
	const dash = [e.before, e.after].some(
		(p) =>
			p &&
			length(p.style["width"] ?? "") >= 8 &&
			length(p.style["width"] ?? "") <= 80 &&
			length(p.style["height"] ?? "") >= 1 &&
			length(p.style["height"] ?? "") <= 6 &&
			chroma(p.style["background-color"] ?? ""),
	)
	return tracked || bold || dash ? e : null
}
export const headingLevel = (e: ElementSnapshot): number =>
	isHeading(e) ? Number(e.tag.slice(1)) : e.attributes["role"] === "heading" ? Number(e.attributes["aria-level"] ?? 2) : 0
export function cardContext(s: PageSnapshot, h: ElementSnapshot, label: ElementSnapshot): boolean {
	for (const a of ancestors(s, h)) {
		if (a.tag === "body") break
		if (![...descendants(s, a)].some((n) => n.index === label.index)) continue
		if (["article", "li", "a", "button"].includes(a.tag) && a.rect.height <= s.viewport.height * 2) return true
		if (headingLevel(h) < 3 || a.rect.height >= s.viewport.height) continue
		const bg = parseColor(styleOf(a, "background-color")),
			framed = radii(a).some((r) => r > 0) && bg !== null && bg.a >= 0.9
		if (!framed) continue
		const own = parseColor(styleOf(label, "background-color"))
		const badge =
			styleOf(label, "position") === "absolute" &&
			(label.rect.y <= a.rect.y + 2 ||
				(own !== null && own.a >= 0.9 && Math.max(Math.abs(own.r - bg.r), Math.abs(own.g - bg.g), Math.abs(own.b - bg.b)) > 3))
		return fontSizePx(h) < 24 || badge
	}
	return false
}
export const nearAbove = (label: ElementSnapshot, h: ElementSnapshot): boolean =>
	label.rect.y + label.rect.height <= h.rect.y + 4 &&
	h.rect.y - label.rect.y - label.rect.height <= Math.max(64, fontSizePx(h) * 2) &&
	label.rect.x < h.rect.x + h.rect.width &&
	label.rect.x + label.rect.width > h.rect.x
