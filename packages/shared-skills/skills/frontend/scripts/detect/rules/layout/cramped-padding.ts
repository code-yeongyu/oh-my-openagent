import { childrenOf, descendants, fontSizePx, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { fillDiffers } from "./support/cards"
import { alpha, borders, bottom, bounds, chain, clipsY, intersects, length, outOfFlow, painted, right } from "./support/geometry"
import { continuedFill, glyphBand, paddingBackdrop, paddingFill, paddingScale, uncut } from "./support/padding"

export const crampedPadding: PageRule = {
	meta: {
		id: "cramped-padding", name: "Cramped padding", category: "quality", severity: "warning", engine: "page",
		description: "Rendered text sits too close to a visible container boundary.",
		fixHint: "Inset text from the painted boundary; use at least 8px beside body text and scale the space with its font size.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		if (!painted(snapshot, el) || styleOf(el, "display") === "inline" || el.rect.width <= 0 || el.rect.height <= 0) return []
		const drawn = borders(el)
		const fill = paddingFill(snapshot, el) && !paddingBackdrop(snapshot, el)
		const outline = length(el, "outline-width") > 0 && !["", "none"].includes(styleOf(el, "outline-style")) && alpha(el, "outline-color") > 0
		const fullBleed = el.rect.width >= snapshot.document.clientWidth * 0.94
		if (!fill && !drawn.some(Boolean) && !outline) return []
		const sides = ["top", "right", "bottom", "left"]
		const inset = (r: typeof el.rect): readonly number[] => [
			r.y - el.rect.y - length(el, "border-top-width"),
			right(el.rect) - right(r) - length(el, "border-right-width"),
			bottom(el.rect) - bottom(r) - length(el, "border-bottom-width"),
			r.x - el.rect.x - length(el, "border-left-width"),
		]
		if (el.ownText.length > 20 && el.rect.width > 100 && el.rect.height > 30 &&
			!(el.tag === "code" && !snapshot.elements.some((a) => a.tag === "pre" && [...descendants(snapshot, a)].includes(el)))) {
			if (!fill && drawn.filter(Boolean).length < 2) return []
			const text = bounds(el.lineRects.filter((r) => intersects(r, el.rect)))
			if (!text) return []
			const band = glyphBand(el, text)
			const clipped = { x: Math.max(band.x, el.rect.x), y: Math.max(band.y, el.rect.y),
				width: Math.min(right(band), right(el.rect)) - Math.max(band.x, el.rect.x),
				height: Math.min(bottom(band), bottom(el.rect)) - Math.max(band.y, el.rect.y) }
			const insets = inset(clipped)
			const size = fontSizePx(el)
			const bad = sides.some((side, i) => {
				const vertical = i === 0 || i === 2
				const threshold = vertical ? Math.max(4, size * 0.3) : Math.max(8, size * 0.5)
				return (drawn[i] || fill && (vertical || !fullBleed)) &&
					length(el, `padding-${side}`) < threshold && (insets[i] ?? Infinity) < threshold
			})
			return bad ? [{ element: el, message: "The measured inset is too small for the text size.", snippet: shortSnippet(el) }] : []
		}
		if (el.ownText !== "" || outOfFlow(el) || /^(html|body|main|header|footer|nav|article|aside|button|a|label|summary|code|pre|input|textarea|select|form|figure|table|tbody|thead|tr|td|th)$/.test(el.tag)) return []
		let kids = childrenOf(snapshot, el)
		let unwrapped = false
		for (let depth = 0; depth < 3; depth++) {
			const only = kids.length === 1 ? kids[0] : undefined
			if (!only || only.ownText !== "" || borders(only).some(Boolean) || fillDiffers(snapshot, only) ||
				["top", "right", "bottom", "left"].some((side) => length(only, `padding-${side}`) > 0) ||
				childrenOf(snapshot, only).length === 0) break
			kids = childrenOf(snapshot, only)
			unwrapped = true
		}
		const texts = [...descendants(snapshot, el)].filter((n) =>
			/^(a|button|code|dd|dt|figcaption|h[1-6]|li|p|pre|span|td|th)$/.test(n.tag) &&
			n.ownText.length > 4 && painted(snapshot, n) && !chain(snapshot, n).slice(0, chain(snapshot, n).indexOf(el))
				.some((c) => outOfFlow(c) || styleOf(c, "display") !== "inline" && paddingFill(snapshot, c)))
		const flush = sides.some((side, i) => {
			if (!(drawn[i] || outline || fill && (!(i === 1 || i === 3) || !fullBleed))) return false
			if (!drawn[i] && !outline && continuedFill(snapshot, el, i)) return false
			if (length(el, `padding-${side}`) > 2) return false
			if (i === 2 && [...descendants(snapshot, el)].some((n) => clipsY(n) &&
				n.scroll.scrollHeight > n.scroll.clientHeight + 1 && Math.abs(bottom(n.rect) - bottom(el.rect)) <= 2)) return false
			const textFlush = texts.some((n) => {
				let r = bounds(n.lineRects)
				if (!r) return false
				const scale = paddingScale(el)
				const small = el.rect.height / scale < 27.5
				if ((small || !fill && !outline && drawn.filter(Boolean).length === 1) && (i === 0 || i === 2)) r = glyphBand(n, r, scale)
				const x = Math.max(r.x, n.rect.x)
				const y = Math.max(r.y, n.rect.y)
				r = { x, y, width: Math.min(right(r), right(n.rect)) - x, height: Math.min(bottom(r), bottom(n.rect)) - y }
				if (r.width <= 0 || r.height <= 0) return false
				if (!uncut(snapshot, n, el, r, i)) return false
				const gap = inset(r)[i] ?? Infinity
				const threshold = (small ? Math.min(4, fontSizePx(n) * 0.25) : 4) * scale
				return gap >= -scale && gap < threshold
			})
			if (!textFlush) return false
			const insulated = (c: typeof el): boolean => {
				if (outOfFlow(c)) return true
				const gap = inset(c.rect)[i] ?? Infinity
				const offset = styleOf(c, "position") === "relative" &&
					["top", "right", "bottom", "left"].some((p) => length(c, p) !== 0) ||
					!["", "none"].includes(styleOf(c, "transform"))
				if (offset) return gap >= 4
				return gap < -1 || gap >= 4 || styleOf(c, "position") === "static" &&
					(length(c, `padding-${side}`) >= 4 || length(c, `margin-${side}`) >= 4)
			}
			return unwrapped || !kids.some(insulated)
		})
		return flush ? [{ element: el, message: "Child text lands flush against a painted container edge.", snippet: shortSnippet(el) }] : []
	}),
}
