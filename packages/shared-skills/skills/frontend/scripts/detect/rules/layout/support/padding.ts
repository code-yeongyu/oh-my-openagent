import { ancestors, childrenOf, descendants, fontSizePx, parentOf, styleOf } from "../../../core/page"
import { parseColor } from "../../../core/color"
import type { ElementSnapshot, PageSnapshot, Rect } from "../../../types"
import { fillDiffers } from "./cards"
import { alpha, bottom, chain, clipsX, clipsY, length, lineHeight, painted, right } from "./geometry"

const same = (a: string, b: string): boolean => {
	const x = parseColor(a)
	const y = parseColor(b)
	return x !== null && y !== null && Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b), Math.abs(x.a - y.a) * 255) < 8
}

export function paddingFill(s: PageSnapshot, el: ElementSnapshot): boolean {
	if (alpha(el, "background-color") === 0 || !fillDiffers(s, el)) return false
	const fill = styleOf(el, "background-color")
	for (const p of ancestors(s, el)) {
		const image = styleOf(p, "background-image")
		const lead = /^linear-gradient\(to (right|left|bottom|top), rgba\(0, 0, 0, 0\) ([\d.]+)(px|%), (rgba?\([^)]*\)) ([\d.]+)(px|%)\)$/.exec(image)
		if (lead && same(fill, lead[4] ?? "") && lead[2] === lead[5] && lead[3] === lead[6]) {
			const vertical = lead[1] === "top" || lead[1] === "bottom"
			const span = vertical ? p.rect.height : p.rect.width
			const stop = Number(lead[2]) * (lead[3] === "%" ? span / 100 : 1)
			if (lead[1] === "right" && el.rect.x >= p.rect.x + stop - 0.5 ||
				lead[1] === "left" && right(el.rect) <= right(p.rect) - stop + 0.5 ||
				lead[1] === "bottom" && el.rect.y >= p.rect.y + stop - 0.5 ||
				lead[1] === "top" && bottom(el.rect) <= bottom(p.rect) - stop + 0.5) return false
		}
		if (alpha(p, "background-color") > 0) break
	}
	return true
}

export function paddingBackdrop(s: PageSnapshot, el: ElementSnapshot): boolean {
	for (const node of chain(s, el).slice(0, 12)) {
		const p = parentOf(s, node)
		if (!p) break
		for (const sibling of childrenOf(s, p).slice(0, childrenOf(s, p).indexOf(node)).reverse()) {
			const r = sibling.rect
			if (styleOf(sibling, "display") === "none" || r.x > el.rect.x + 1 || r.y > el.rect.y + 1 ||
				right(r) < right(el.rect) - 1 || bottom(r) < bottom(el.rect) - 1) continue
			if (alpha(sibling, "background-color") > 0) return same(styleOf(el, "background-color"), styleOf(sibling, "background-color"))
			if ([sibling, ...descendants(s, sibling)].some((n) => /^(img|video)$/.test(n.tag) && painted(s, n) &&
				n.rect.x <= el.rect.x + 1 && n.rect.y <= el.rect.y + 1 && right(n.rect) >= right(el.rect) - 1 && bottom(n.rect) >= bottom(el.rect) - 1)) return true
		}
		if (alpha(p, "background-color") > 0) break
	}
	return false
}

export function continuedFill(s: PageSnapshot, el: ElementSnapshot, side: number): boolean {
	const r = el.rect
	const reaches = (b: Rect): boolean => Math.abs([bottom(b) - r.y, b.x - right(r), b.y - bottom(r), right(b) - r.x][side] ?? Infinity) <= 1.5
	const along = (b: Rect): boolean => side % 2 === 0
		? Math.min(right(r), right(b)) - Math.max(r.x, b.x) >= r.width * 0.9
		: Math.min(bottom(r), bottom(b)) - Math.max(r.y, b.y) >= r.height * 0.9
	const search = (node: ElementSnapshot, depth: number): boolean => {
		if (!reaches(node.rect) || !painted(s, node)) return false
		if (along(node.rect) && same(styleOf(el, "background-color"), styleOf(node, "background-color"))) return true
		return depth < 6 && childrenOf(s, node).some((n) => search(n, depth + 1))
	}
	for (const node of chain(s, el).slice(0, 5)) {
		const p = parentOf(s, node)
		if (p && childrenOf(s, p).some((n) => n !== node && search(n, 0))) return true
	}
	return false
}

export function glyphBand(el: ElementSnapshot, r: Rect, scale = 1): Rect {
	const size = fontSizePx(el) * scale
	const pitch = lineHeight(el) * scale
	const count = Math.max(1, Math.round((r.height - size) / pitch) + 1)
	const inset = Math.max(0, (r.height - (count - 1) * pitch - size) / 2)
	return { ...r, y: r.y + inset, height: r.height - inset * 2 }
}

export const paddingScale = (el: ElementSnapshot): number => {
	const layout = el.scroll.clientWidth + length(el, "border-left-width") + length(el, "border-right-width")
	const scale = el.rect.width / layout
	return scale > 0.05 && scale < 0.95 ? scale : 1
}

export function uncut(s: PageSnapshot, node: ElementSnapshot, wrapper: ElementSnapshot, r: Rect, side: number): boolean {
	for (const p of chain(s, node)) {
		if (styleOf(p, "display") !== "inline") {
			if (side === 1 && clipsX(p) && right(r) > right(p.rect) - length(p, "border-right-width") + 0.5 ||
				side === 3 && clipsX(p) && r.x < p.rect.x + length(p, "border-left-width") - 0.5 ||
				side === 0 && clipsY(p) && r.y < p.rect.y + length(p, "border-top-width") - 0.5 ||
				side === 2 && clipsY(p) && bottom(r) > bottom(p.rect) - length(p, "border-bottom-width") + 0.5) return false
		}
		if (p === wrapper) break
	}
	return true
}
