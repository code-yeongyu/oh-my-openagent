import { fontSizePx, shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"
import { bottom, length } from "./support/geometry"
import { closesInProse, contentBottom, headingCluster, neighbour, paintsEdge, rhythmExempt, separatesBelow } from "./support/rhythm"

export const headingRhythm: PageRule = {
	meta: {
		id: "heading-rhythm", name: "Heading crowded against the previous block", category: "quality", severity: "warning", engine: "page",
		description: "Several headings sit closer to preceding content than to the content they introduce.",
		fixHint: "Give section headings more space above than below so each title binds to its own content.",
	},
	check: ({ snapshot }) => {
		const hits = snapshot.elements.flatMap((el) => {
			if (rhythmExempt(snapshot, el)) return []
			const next = neighbour(snapshot, el, false)
			if (!next) return []
			const below = Math.max(0, next.rect.y - bottom(el.rect))
			if (below < 6 || below > 160) return []
			const top = headingCluster(snapshot, el, below)
			const previous = neighbour(snapshot, el, true, top)
			if (!previous || separatesBelow(snapshot, previous)) return []
			const above = Math.max(0, top.rect.y - contentBottom(snapshot, previous) + (paintsEdge(top, "top") ? 0 : length(top, "padding-top")))
			const crowded = above < below * 0.75 && below - above >= 12
			const body = snapshot.elements.find((n) => n.tag === "body")
			const even = above <= below + 2 && closesInProse(snapshot, previous, el, Math.max(body ? fontSizePx(body) : 16, fontSizePx(next)))
			return crowded || even ? [{ element: el, message: `Heading has ${Math.round(above)}px above and ${Math.round(below)}px below.`, snippet: shortSnippet(el) }] : []
		})
		return hits.length >= 2 ? hits : []
	},
}
