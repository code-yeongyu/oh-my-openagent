import { descendants, fontSizePx, shortSnippet, styleOf } from "../../core/page"
import type { PageHit, PageRule } from "../../rule"
import type { ElementSnapshot, PageSnapshot, Rect } from "../../types"
import { alpha, borders, bottom, bounds, chain, clipsX, clipsY, intersects, length, painted, right } from "./support/geometry"

const layered = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	chain(s, el).some((n) => /^(absolute|fixed|sticky)$/.test(styleOf(n, "position")))
const pinned = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	chain(s, el).some((n) => /^(fixed|sticky)$/.test(styleOf(n, "position")))
const opaque = (el: ElementSnapshot): boolean =>
	alpha(el, "background-color") > 0.6 || borders(el).filter(Boolean).length >= 2
const z = (s: PageSnapshot, el: ElementSnapshot): number =>
	chain(s, el).reduce((sum, n) => sum + (Number.parseInt(styleOf(n, "z-index"), 10) || 0), 0)

function visibleLines(s: PageSnapshot, el: ElementSnapshot): readonly Rect[] {
	return el.lineRects.flatMap((line) => {
		let x = Math.max(0, line.x)
		let y = Math.max(0, line.y)
		let end = Math.min(s.viewport.width, right(line))
		let low = Math.min(s.viewport.height, bottom(line))
		for (const c of chain(s, el)) {
			if (clipsX(c)) { x = Math.max(x, c.rect.x); end = Math.min(end, right(c.rect)) }
			if (clipsY(c)) { y = Math.max(y, c.rect.y); low = Math.min(low, bottom(c.rect)) }
		}
		return end - x >= 6 && low - y >= 6 ? [{ x, y, width: end - x, height: low - y }] : []
	})
}

export const textOcclusion: PageRule = {
	meta: {
		id: "text-occlusion", name: "Text occluded by an overlapping element", category: "quality", severity: "warning", engine: "page",
		description: "An overlapping surface or text run covers readable words.",
		fixHint: "Separate the layers, remove leaking inline padding, or position the text outside the overlapping surface.",
	},
	check: ({ snapshot }) => {
		const hits: PageHit[] = []
		const nodes = snapshot.elements.filter((n) => painted(snapshot, n))
		for (const el of nodes) {
			if ([...el.ownText].length < 2 || el.rect.width < 6 || el.rect.height < 6 ||
				el.lineRects.every((r) => r.height <= 1) || alpha(el, "color") <= 0.02 ||
				chain(snapshot, el).reduce((opacity, n) => opacity * (Number.parseFloat(styleOf(n, "opacity")) || 0), 1) <= 0.02 ||
				/blur\((?:[4-9]|\d{2,})px\)/.test(styleOf(el, "filter"))) continue
			const lines = visibleLines(snapshot, el)
			const total = lines.reduce((n, r) => n + r.width * r.height, 0)
			if (total === 0) continue
			const full = bounds(el.lineRects)
			const visible = bounds(lines)
			if (full && visible && (visible.width / full.width < 0.25 || el.lineRects.length === 1 && visible.height / full.height < 0.5)) continue
			const related = new Set([...chain(snapshot, el), ...descendants(snapshot, el)])
			const cover = nodes.find((other) => {
				if (related.has(other) || pinned(snapshot, other) || /^(img|video|canvas|picture)$/.test(other.tag) ||
					styleOf(other, "pointer-events") === "none") return false
				const text = other.ownText.length >= 2 && other.lineRects.some((r) => r.height > 1)
				if (!opaque(other) && !text) return false
				if (text && !layered(snapshot, el) && !layered(snapshot, other)) return false
				if (z(snapshot, other) < z(snapshot, el) || z(snapshot, other) === z(snapshot, el) && other.index < el.index && !text) return false
				if (other.ownText === el.ownText && styleOf(other, "font-family") === styleOf(el, "font-family") &&
					Math.abs(other.rect.x - el.rect.x) < 1 && Math.abs(other.rect.y - el.rect.y) < 1 && !opaque(other)) return false
				const regions = opaque(other) ? [other.rect] : other.lineRects
				let covered = 0
				for (const line of lines) {
					for (const r of regions) {
						if (!intersects(line, r)) continue
						covered += (Math.min(right(line), right(r)) - Math.max(line.x, r.x)) *
							(Math.min(bottom(line), bottom(r)) - Math.max(line.y, r.y))
					}
				}
				return covered / total >= (opaque(other) ? 0.3 : 0.45)
			})
			if (cover) hits.push({ element: el, message: `Text overlaps ${cover.selector}.`, snippet: shortSnippet(el) })
		}
		for (const el of nodes) {
			if (styleOf(el, "display") !== "inline" || !opaque(el)) continue
			const padding = Math.max(length(el, "padding-top"), length(el, "padding-bottom"))
			if (padding < 12) continue
			const expanded = { ...el.rect, y: el.rect.y - padding, height: el.rect.height + padding * 2 }
			const siblings = nodes.filter((n) => n.parent === el.parent && n !== el)
			if (siblings.some((n) => n.lineRects.some((r) => intersects(expanded, r)))) {
				hits.push({ element: el, message: "Inline vertical padding paints over nearby content.", snippet: shortSnippet(el) })
			}
		}
		return hits
	},
}
