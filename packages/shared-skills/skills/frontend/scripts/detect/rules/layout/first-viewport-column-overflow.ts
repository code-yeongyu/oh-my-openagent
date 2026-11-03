import { ancestors, childrenOf, descendants, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { bottom, chain, clipsY, hasRole, outOfFlow, painted, right } from "./support/geometry"

export const firstViewportColumnOverflow: PageRule = {
	meta: {
		id: "first-viewport-column-overflow", name: "One column stretches the first viewport", category: "quality", severity: "warning", engine: "page",
		description: "An opening row has one column extending far below the fold while its sibling fits on one screen.",
		fixHint: "Balance the opening columns, cap the longer one, or let its remaining content flow below the row.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		const { width, height } = snapshot.viewport
		if (!/^(inline-)?(flex|grid)$/.test(styleOf(el, "display")) || !painted(snapshot, el) ||
			el.rect.width < width * 0.5 || el.rect.y >= height * 0.9 || bottom(el.rect) <= height) return []
		const rail = (n: typeof el): boolean => {
			if (n.tag === "nav" || hasRole(n, ["navigation", "tablist"]) || styleOf(n, "position") === "sticky") return true
			const nodes = [n, ...descendants(snapshot, n)].filter((c) => c.ownText !== "" && painted(snapshot, c))
			return nodes.length >= 3 && nodes.filter((c) => chain(snapshot, c).some((a) => a.tag === "a" || hasRole(a, ["tab", "menuitem"]))).length / nodes.length >= 0.8
		}
		const cols = childrenOf(snapshot, el).flatMap((child) => {
			const share = child.rect.width / el.rect.width
			if (!painted(snapshot, child) || outOfFlow(child) || rail(child) || share < 0.25 || share > 0.9 || child.rect.height < 40) return []
			let end = child.rect.y
			for (const d of descendants(snapshot, child)) {
				if (!painted(snapshot, d) || [d, ...ancestors(snapshot, d)].some((n) => n !== el && outOfFlow(n))) continue
				let visible = bottom(d.rect)
				for (const a of ancestors(snapshot, d)) {
					if (a === el) break
					if (clipsY(a)) visible = Math.min(visible, bottom(a.rect))
				}
				end = Math.max(end, visible)
			}
			return end - child.rect.y < 1 ? [] : [{ rect: child.rect, height: end - child.rect.y }]
		}).sort((a, b) => b.height - a.height)
		const tall = cols[0]
		if (!tall || tall.height <= height * 1.4) return []
		const short = cols.slice(1).filter((c) =>
			!(tall.rect.x < right(c.rect) - 1 && c.rect.x < right(tall.rect) - 1) &&
			Math.abs(tall.rect.y - c.rect.y) <= height * 0.25).sort((a, b) => a.height - b.height)[0]
		if (!short || short.height > height) return []
		return [{ element: el, message: `Opening columns use ${Math.round(tall.height / height * 100)}% and ${Math.round(short.height / height * 100)}% of the viewport height.`, snippet: shortSnippet(el) }]
	}),
}
