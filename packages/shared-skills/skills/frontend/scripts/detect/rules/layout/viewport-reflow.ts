import { shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"
import type { ElementSnapshot, PageSnapshot } from "../../types"
import { chain, clipsX, painted, right, scrollsX } from "./support/geometry"

function reaches(s: PageSnapshot, el: ElementSnapshot): number {
	let end = Math.max(right(el.rect), ...el.lineRects.map(right))
	if (clipsX(el)) end = right(el.rect)
	for (const ancestor of chain(s, el).slice(1)) {
		if (clipsX(ancestor) && ancestor.tag !== "body") end = Math.min(end, right(ancestor.rect))
	}
	return end
}

export const viewportReflow: PageRule = {
	meta: {
		id: "viewport-reflow", name: "Viewport reflow", category: "quality", severity: "error", engine: "page",
		description: "The document is wider than the viewport and requires sideways scrolling.",
		fixHint: "Constrain the widest content, allow long tokens to wrap, and keep intentional horizontal scrolling inside its own region.",
	},
	check: ({ snapshot }) => {
		if (snapshot.document.scrollWidth <= snapshot.document.clientWidth) return []
		const widest = snapshot.elements
			.filter((el) => painted(snapshot, el) && reaches(snapshot, el) > snapshot.document.clientWidth &&
				!chain(snapshot, el).slice(1).some((n) => n.tag !== "body" && scrollsX(n)))
			.sort((a, b) => reaches(snapshot, b) - reaches(snapshot, a))[0]
		return [{
			element: null,
			message: `Document width ${snapshot.document.scrollWidth}px exceeds ${snapshot.document.clientWidth}px${widest ? `; furthest element ${widest.selector} ends at ${reaches(snapshot, widest)}px` : ""}.`,
			snippet: widest ? shortSnippet(widest) : `${snapshot.document.scrollWidth}px / ${snapshot.document.clientWidth}px`,
		}]
	},
}
