import { ancestors, childrenOf, descendants, effectiveBackground, fontSizePx, parentOf, styleOf } from "../../../core/page"
import { blend, contrastRatio, parseColor, WHITE } from "../../../core/color"
import { parseShadow } from "../../../core/shadow"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { borders, bottom, chain, clipsX, clipsY, hasRole, length, lineHeight, painted, right, scrollsX } from "./geometry"

const shadowLayers = (el: ElementSnapshot) => parseShadow(styleOf(el, "box-shadow")).filter((s) => s.color.a >= 0.05)
export const hasBorderOrShadow = (el: ElementSnapshot): boolean =>
	borders(el).some(Boolean) || shadowLayers(el).some((s) => s.x !== 0 || s.y !== 0 || s.blur > 0 || s.spread !== 0)

export function fillDiffers(s: PageSnapshot, el: ElementSnapshot): boolean {
	if (!["none", ""].includes(styleOf(el, "background-image"))) return true
	const fill = parseColor(styleOf(el, "background-color"))
	if (!fill || fill.a === 0) return false
	const p = parentOf(s, el)
	const under = p ? effectiveBackground(s, p) : WHITE
	const shown = blend(fill, under)
	return Math.max(Math.abs(shown.r - under.r), Math.abs(shown.g - under.g), Math.abs(shown.b - under.b)) > 3
}

export function cardLike(s: PageSnapshot, el: ElementSnapshot): boolean {
	if (/^(a|button|label|input|select|textarea|img|video|canvas|picture|svg|path|span|code|pre)$/.test(el.tag)) return false
	const layers = shadowLayers(el)
	const shadow = layers.some((l) => l.x !== 0 || l.y !== 0 || l.blur > 0 || l.spread !== 0)
	const rounded = ["top-left", "top-right", "bottom-right", "bottom-left"].some((c) => Number.parseFloat(styleOf(el, `border-${c}-radius`)) > 0)
	if (!shadow && !rounded) return false
	const p = parentOf(s, el)
	const under = p ? effectiveBackground(s, p) : WHITE
	const ink = parseColor(styleOf(el, "color"))
	const canJudge = ink !== null && contrastRatio(blend(ink, under), under) >= 3
	const sides = borders(el).map((visible, i) => {
		const side = ["top", "right", "bottom", "left"][i] ?? "top"
		const color = parseColor(styleOf(el, `border-${side}-color`))
		if (!visible || !canJudge || !color) return visible
		const edge = blend(color, effectiveBackground(s, el))
		return Math.max(Math.abs(edge.r - under.r), Math.abs(edge.g - under.g), Math.abs(edge.b - under.b)) >= 8
	})
	for (const l of layers.filter((l) => !l.inset)) {
		const spread = l.spread + l.blur / 2
		for (const [i, reach] of [spread - l.y, spread + l.x, spread + l.y, spread - l.x].entries()) if (reach >= 1) sides[i] = true
	}
	return sides.filter(Boolean).length >= 3 || fillDiffers(s, el)
}

export function labelBox(s: PageSnapshot, el: ElementSnapshot): boolean {
	const radius = Number.parseFloat(styleOf(el, "border-top-left-radius"))
	if (radius >= el.rect.height / 2 - 0.5) return true
	const kids = childrenOf(s, el)
	const chrome = ["padding-top", "padding-bottom", "border-top-width", "border-bottom-width"].reduce((n, p) => n + length(el, p), 0)
	return (kids.length === 0 && el.lineRects.length === 1 && el.rect.height <= lineHeight(el) * 3) ||
		el.rect.height - chrome <= lineHeight(el) * 1.5
}

export function embeddedFrame(s: PageSnapshot, el: ElementSnapshot, outer: ElementSnapshot): boolean {
	const nodes = [...descendants(s, el)].filter((n) => painted(s, n))
	const controls = nodes.filter((n) => n.tag === "button" || hasRole(n, ["button"]) || n.tag === "input" || n.tag === "select")
	const realControls = controls.filter((n) => !/copy|more|play|pause|mute|volume|seek|fullscreen|speed/i.test(n.attributes["aria-label"] ?? n.text))
	if (realControls.length > 0) return false
	if ([...descendants(s, el)].some((n) => n.tag === "audio") && controls.length > 0 && nodes.some((n) => hasRole(n, ["slider"]))) return true
	const area = el.rect.width * el.rect.height
	if (nodes.some((n) => /^(svg|canvas|img|video|iframe|picture)$/.test(n.tag) && n.rect.width * n.rect.height >= area * 0.4) && el.text.length <= 300) return true
	if (nodes.some((n) => /^(video|audio)$/.test(n.tag) && n.rect.width >= 80) && controls.length > 0) return true
	if (!/monospace/i.test(styleOf(outer, "font-family"))) {
		const all = [el, ...nodes]
		const total = all.reduce((n, c) => n + c.ownText.replace(/\s/g, "").length, 0)
		const mono = all.filter((n) => /monospace/i.test(styleOf(n, "font-family"))).reduce((n, c) => n + c.ownText.replace(/\s/g, "").length, 0)
		if (total > 0 && mono / total >= 0.9 && all.some((n) => /^(pre|code|samp|kbd|output)$/.test(n.tag) || n.ownText.length >= el.text.length * 0.6 || /const |await |=>|[{};]/.test(n.text))) return true
	}
	return false
}

export function fieldBox(s: PageSnapshot, el: ElementSnapshot): boolean {
	const kids = childrenOf(s, el).filter((c) => painted(s, c))
	const field = (c: ElementSnapshot): boolean => /^(input|textarea|select)$/.test(c.tag) || c.attributes["contenteditable"] === "true"
	return kids.some(field) && kids.every((c) => field(c) || c.text.length <= 20 && [c, ...descendants(s, c)].some((n) => n.tag === "button"))
}

export function sharesEdges(s: PageSnapshot, el: ElementSnapshot, outer: ElementSnapshot): boolean {
	const a = el.rect
	const b = outer.rect
	const edges = [
		Math.abs(a.y - b.y - length(outer, "border-top-width")) <= 1.5,
		Math.abs(right(a) - right(b) + length(outer, "border-right-width")) <= 1.5,
		Math.abs(bottom(a) - bottom(b) + length(outer, "border-bottom-width")) <= 1.5,
		Math.abs(a.x - b.x - length(outer, "border-left-width")) <= 1.5,
	]
	if (edges.filter(Boolean).length >= 3) return true
	if (!((edges[0] || edges[2]) && (edges[1] || edges[3]))) return false
	return [...ancestors(s, el)].some((c) => (clipsX(c) || clipsY(c)) &&
		((Math.abs(a.width - c.rect.width) <= 1.5 && c.rect.height > a.height + 1.5) ||
			(Math.abs(a.height - c.rect.height) <= 1.5 && c.rect.width > a.width + 1.5)))
}

export function controlStrip(s: PageSnapshot, el: ElementSnapshot): boolean {
	const p = parentOf(s, el)
	if (p && scrollsX(p)) return true
	const kids = childrenOf(s, el)
	const first = kids[0]
	return first !== undefined && kids.length >= 3 && kids.every((c) =>
		(c.tag === "a" || c.tag === "button" || hasRole(c, ["link", "button", "tab"])) && c.rect.height <= 64 &&
		Math.min(bottom(c.rect), bottom(first.rect)) - Math.max(c.rect.y, first.rect.y) > Math.min(c.rect.height, first.rect.height) * 0.5)
}

export function dialogCard(s: PageSnapshot, el: ElementSnapshot): boolean {
	for (const a of chain(s, el)) {
		if (a.tag === "dialog" || hasRole(a, ["dialog", "alertdialog"])) return true
		if (a !== el && cardLike(s, a)) return false
	}
	return false
}

export const pageFrame = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	el.rect.x <= 1 && el.rect.width >= s.document.clientWidth - 1 && el.rect.height >= s.document.scrollHeight * 0.75 &&
	!borders(el).some(Boolean) && !fillDiffers(s, el) && shadowLayers(el).every((l) => l.color.a <= 0.05)
