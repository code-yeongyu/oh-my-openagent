import { childrenOf, descendants, effectiveBackground, fontSizePx, parentOf, px, styleOf } from "../../../core/page"
import { parseColor } from "../../../core/color"
import { parseShadow } from "../../../core/shadow"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { displayed, lineage } from "./page-text"

export const parsedIndex = (text: string): number | null => {
	if (text.length > 40) return null
	const hash = /^#([0-9]{1,2})(?: [^ ].*)?$/.exec(text)
	if (hash && /^#\d+ (rated|ranked|rank|best|top|in|pick|choice|overall|seller|bestseller|selling|voted|place|trending)\b/i.test(text)) return null
	const match = hash ?? /^([0-9]{2})$/.exec(text) ?? /^([0-9]{1,2})\s*[^0-9A-Za-z_\s]\s*\S/.exec(text)
	return match?.[1] !== undefined && Number(match[1]) <= 40 ? Number(match[1]) : null
}

export const labelBefore = (snapshot: PageSnapshot, heading: ElementSnapshot): ElementSnapshot | null => {
	let current = heading
	for (let level = 0; level <= 4; level++) {
		const parent = parentOf(snapshot, current)
		if (!parent) return null
		const siblings = childrenOf(snapshot, parent)
		const label = siblings[siblings.findIndex((s) => s.index === current.index) - 1]
		if (label) {
			const l = label.rect
			const h = heading.rect
			if (level > 1 && (l.width <= 0 || l.height <= 0 || h.width <= 0 || h.height <= 0 || l.y >= h.y + h.height
				|| Math.max(h.y - l.y - l.height, h.x - l.x - l.width, 0) > 96)) return null
			return label
		}
		if (["body", "html"].includes(parent.tag)) return null
		current = parent
	}
	return null
}

export const labelType = (snapshot: PageSnapshot, label: ElementSnapshot): ElementSnapshot => {
	let el = label
	for (let level = 0; level < 3; level++) {
		if (el.ownText !== "") return el
		const children = childrenOf(snapshot, el).filter((c) => c.text.trim() !== "")
		const only = children[0]
		if (children.length !== 1 || !only) return el
		el = only
	}
	return el
}

const drawsBox = (snapshot: PageSnapshot, el: ElementSnapshot): boolean => {
	const parent = parentOf(snapshot, el)
	const under = parent ? effectiveBackground(snapshot, parent) : { r: 255, g: 255, b: 255 }
	const fill = effectiveBackground(snapshot, el)
	const image = styleOf(el, "background-image")
	const border = ["top", "right", "bottom", "left"].filter((side) =>
		(px(styleOf(el, `border-${side}-width`)) ?? 0) >= 0.5
		&& !["none", "hidden", ""].includes(styleOf(el, `border-${side}-style`))
		&& (parseColor(styleOf(el, `border-${side}-color`))?.a ?? 0) > 0).length >= 3
	return Math.max(Math.abs(fill.r - under.r), Math.abs(fill.g - under.g), Math.abs(fill.b - under.b)) > 3
		|| image !== "" && image !== "none" || border
		|| parseShadow(styleOf(el, "box-shadow")).some((layer) => layer.color.a >= 0.03
			&& (layer.x !== 0 || layer.y !== 0 || layer.blur > 0 || layer.spread !== 0))
}

export const labelContext = (snapshot: PageSnapshot, el: ElementSnapshot, partner: ElementSnapshot = el): boolean => {
	const path = lineage(snapshot, el)
	if (!displayed(snapshot, el) || path.some((a) => ["nav", "form", "table", "thead", "tbody", "tfoot", "figure", "figcaption", "ol", "ul", "li"].includes(a.tag)
		|| a.attributes["role"] === "navigation" || a.attributes["aria-hidden"] === "true"
		|| a.attributes["data-impeccable-allow-kickers"] !== undefined
		|| /breadcrumb/i.test(`${a.attributes["class"] ?? ""} ${a.attributes["aria-label"] ?? ""}`))) return false
	const context = path.find((a) => ["article", "button", "a", "li"].includes(a.tag) || ["listitem", "option"].includes(a.attributes["role"] ?? ""))
	if (!context || context.rect.height > snapshot.viewport.height * 2 || !lineage(snapshot, partner).includes(context)) return true
	if (context.tag !== "article") return false
	const above = lineage(snapshot, context).slice(1)
	if (above.some((a) => ["a", "button", "li"].includes(a.tag) || ["listitem", "option"].includes(a.attributes["role"] ?? ""))) return false
	if (path.slice(1, path.findIndex((a) => a.index === context.index) + 1).some((a) =>
		lineage(snapshot, partner).includes(a) && drawsBox(snapshot, a))) return false
	let below = context
	for (const up of above.slice(0, 3)) {
		if (up.tag === "body") break
		const otherArticle = [...descendants(snapshot, up)].some((a) => a.tag === "article" && a.index !== context.index)
		if (!otherArticle && drawsBox(snapshot, up)) return false
		if (up.children.length !== 1 || up.children[0] !== below.index) break
		below = up
	}
	return true
}

export const styledLabel = (label: ElementSnapshot, heading: ElementSnapshot): boolean => {
	const size = fontSizePx(label)
	const headingSize = fontSizePx(heading)
	if (size <= 0 || size > Math.max(13, Math.min(16, headingSize * 0.45)) || headingSize > 0 && headingSize < size * 1.3) return false
	const color = parseColor(styleOf(label, "color"))
	return /mono/i.test(styleOf(label, "font-family")) || Number(styleOf(label, "font-weight")) >= 600
		|| (px(styleOf(label, "letter-spacing")) ?? 0) >= 0.5 || styleOf(label, "text-transform") === "uppercase"
		|| (color !== null && Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) >= 40)
}
