import { descendants, fontSizePx, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import type { ElementSnapshot, PageSnapshot, Rect } from "../../types"
import { alpha, borders, bottom, bounds, chain, clipRect, clipsX, clipsY, intersects, length, painted, right, scrollsX, textLines } from "./support/geometry"
import { shell } from "./support/clipping"
import { openingWidth } from "./support/motion"

const truncates = (el: ElementSnapshot): boolean =>
	!["inline", "contents"].includes(styleOf(el, "display")) && clipsX(el) &&
	(!["", "clip"].includes(styleOf(el, "text-overflow")) || Number.parseInt(styleOf(el, "-webkit-line-clamp"), 10) > 0)

function harm(s: PageSnapshot, el: ElementSnapshot, box: Rect, text: Rect): boolean {
	const code = chain(s, el).some((n) => ["pre", "code"].includes(n.tag))
	const tolerance = fontSizePx(el) * 0.25
	let cut = false
	for (const c of chain(s, el)) {
		if (styleOf(c, "display") === "inline" || !clipsX(c)) continue
		const clip = clipRect(c)
		if (text.x < clip.x - 1 || right(text) > right(clip) + 1) {
			if (!code) return true
			if (text.x < clip.x - 1 && clip.x > tolerance ||
				right(text) > right(clip) + 1 && right(clip) < s.viewport.width - tolerance) cut = true
		}
	}
	if (cut) return false
	if (text.x <= tolerance || right(text) >= s.viewport.width - tolerance) return true
	const related = new Set([...chain(s, el), ...descendants(s, el)])
	return s.elements.some((other) => {
		if (related.has(other) || !painted(s, other) || other.rect.width <= 2 || other.rect.height <= 2) return false
		if (other.ownText === "" && !/^(img|video|canvas|svg|picture)$/.test(other.tag) && alpha(other, "background-color") < 0.25 && !borders(other).some(Boolean) &&
			["", "none"].includes(styleOf(other, "background-image"))) return false
		const r = other.rect
		if (r.x <= box.x && right(r) >= right(box) && r.y <= box.y && bottom(r) >= bottom(box)) return false
		return intersects(text, r) && (right(r) > right(box) && r.x < right(text) || r.x < box.x && right(r) > text.x)
	})
}

export const textOverflow: PageRule = {
	meta: {
		id: "text-overflow", name: "Content overflowing its container", category: "quality", severity: "warning", engine: "page",
		description: "Text spills out of its box into a clip, another element, or the viewport edge.",
		fixHint: "Allow wrapping, constrain the content width, or provide a deliberate horizontal scroll region.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		if (el.ownText === "" || /^(input|textarea|select|option|svg|path|script|style)$/.test(el.tag) || !painted(snapshot, el)) return []
		const path = chain(snapshot, el)
		if (path.some((n) => n.tag === "svg")) return []
		if (openingWidth(snapshot, el)) return []
		const code = path.some((n) => ["pre", "code", "samp", "kbd"].includes(n.tag))
		if (path.some((n) => scrollsX(n) && !(code && n !== el && shell(snapshot, n))) || path.some(truncates)) return []
		const text = bounds(textLines(snapshot, el))
		if (!text) return []
		if (path.some((c) => clipsY(c) && (text.y >= bottom(clipRect(c)) || bottom(text) <= clipRect(c).y))) return []
		if (path.some((c) => styleOf(c, "display") !== "inline" && clipsX(c) && (right(text) <= clipRect(c).x || text.x >= right(clipRect(c))))) return []
		const box = styleOf(el, "display") === "inline"
			? path.slice(1).find((c) => c.scroll.clientWidth > 0 && styleOf(c, "display") !== "inline") ?? el
			: el
		const start = box.rect.x + length(box, "border-left-width")
		const end = start + (box.scroll.clientWidth > 0 ? box.scroll.clientWidth : box.rect.width)
		const generated = [el.before, el.after].some((p) => p !== null && /["'][^"']+["']/.test(p.style["content"] ?? "") &&
			p.style["display"] !== "none")
		const reach = generated && el.scroll.scrollWidth > el.scroll.clientWidth
			? { ...text, width: Math.max(text.width, el.scroll.scrollWidth) } : text
		const delta = Math.max(right(reach) - end, start - reach.x)
		const drawn = alpha(box, "background-color") > 0 || borders(box).some(Boolean)
		const pastContent = Math.max(right(text) - end + length(box, "padding-right"), start + length(box, "padding-left") - text.x)
		const paintedSpill = !code && drawn && !clipsX(box) && delta < 16 &&
			delta >= Math.max(fontSizePx(el) * 0.25, 2) && pastContent >= 15
		if (!(delta >= 16 && harm(snapshot, el, box.rect, reach) || paintedSpill)) return []
		return [{ element: el, message: `Text extends ${Math.round(delta)}px past its container.`, snippet: shortSnippet(el) }]
	}),
}
