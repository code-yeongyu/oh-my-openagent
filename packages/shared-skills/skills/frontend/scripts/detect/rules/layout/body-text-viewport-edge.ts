import { childrenOf, fontSizePx, isIgnored, shortSnippet, styleOf } from "../../core/page"
import type { PageHit, PageRule } from "../../rule"
import { alpha, bounds, chain, clipsX, length, outOfFlow, painted, right, scrollsX, textLines } from "./support/geometry"
import { trackCuts } from "./support/clipping"
import { ridesRunningTrack } from "./support/motion"

export const bodyTextViewportEdge: PageRule = {
	meta: {
		id: "body-text-viewport-edge", name: "Body text touching viewport edge", category: "quality", severity: "warning", engine: "page",
		description: "Reading text touches the viewport edge without a usable gutter.",
		fixHint: "Keep at least 12px of horizontal space on phones and 16px on wider screens; constrain overflowing columns.",
	},
	check: ({ snapshot }) => {
		const width = snapshot.viewport.width
		const floor = width <= 480 ? 12 : 16
		const hits: PageHit[] = []
		let overflow = false
		for (const el of snapshot.elements) {
			if (isIgnored(snapshot, el, "body-text-viewport-edge")) continue
			const prose = ["p", "li"].includes(el.tag)
			const generic = ["div", "section", "article", "aside", "main"].includes(el.tag) &&
				el.ownText !== "" && fontSizePx(el) < 28 && ["block", "flow-root"].includes(styleOf(el, "display")) &&
				childrenOf(snapshot, el).every((c) => styleOf(c, "display") === "inline")
			if (!(prose || generic) || el.text.length <= 40 || !painted(snapshot, el) || outOfFlow(el) ||
				el.rect.width <= width * 0.5 || alpha(el, "background-color") > 0) continue
			if (ridesRunningTrack(snapshot, el)) continue
			const path = chain(snapshot, el)
			if (generic && path.some((n) => /^(a|button|label|summary|select|textarea)$/.test(n.tag) ||
				/^(button|link|tab|menuitem|option)$/.test(n.attributes["role"] ?? "") || n.attributes["contenteditable"] !== undefined)) continue
			if (path.some((n) => n.tag === "nav" || n.tag === "header" && n.rect.height <= snapshot.viewport.height ||
				scrollsX(n) || /^(pre|pre-wrap)$/.test(styleOf(n, "white-space")))) continue
			const lines = textLines(snapshot, el)
			const text = bounds(lines)
			if (!text && generic) continue
			if (text && trackCuts(snapshot, el, text)) continue
			let left = text?.x ?? el.rect.x
			let end = text ? right(text) : right(el.rect)
			if (clipsX(el) && !["", "clip"].includes(styleOf(el, "text-overflow"))) {
				left = Math.max(left, el.rect.x)
				end = Math.min(end, right(el.rect))
			}
			const contentLeft = el.rect.x + length(el, "padding-left") + length(el, "border-left-width")
			const contentEnd = right(el.rect) - length(el, "padding-right") - length(el, "border-right-width")
			if (text && lines.length >= 2 && text.width >= (contentEnd - contentLeft) * 0.9 &&
				!(styleOf(el, "text-align") !== "justify" && left >= 16 && end <= width - 16)) {
				left = contentLeft
				end = contentEnd
			} else if (styleOf(el, "display") === "list-item") {
				left = Math.min(left, contentLeft)
			}
			if (end <= 0 || left >= width) continue
			if (path.slice(1).some((n) => styleOf(n, "position") === "fixed" && n.rect.height < snapshot.viewport.height / 2) && Math.min(left, width - end) >= 4) continue
			if (Math.round(-left) > 0 || Math.round(end - width) > 0) overflow = true
			if (Math.round(left) >= 0 && left < floor || Math.round(width - end) >= 0 && width - end < floor) hits.push({ element: el, message: `Body copy keeps less than ${floor}px from the viewport edge.`, snippet: shortSnippet(el) })
		}
		if (overflow) {
			const widest = snapshot.elements.filter((el) => painted(snapshot, el) && !chain(snapshot, el).some(scrollsX)).sort((a, b) => right(b.rect) - right(a.rect))[0]
			hits.push({ element: null, message: `Body text runs outside the viewport${widest ? `; widest element ${widest.selector} ends at ${right(widest.rect)}px` : ""}.`, snippet: widest ? shortSnippet(widest) : "Page overflow" })
		}
		return hits
	},
}
