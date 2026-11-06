import { descendants, fontSizePx, shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"
import { visibleText } from "./support/text-context"

export const oversizedH1: PageRule = {
	meta: {
		id: "oversized-h1", name: "Oversized hero headline", category: "slop", severity: "warning", engine: "page",
		description: "A sentence-length display headline consumes too much of the first screen.",
		fixHint: "Shorten the headline or reduce its font size so supporting content fits above the fold.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		if (element.tag !== "h1" || visibleText(snapshot, element) === false ||
			fontSizePx(element) < 72 || element.rect.y >= snapshot.viewport.height) return []
		const text = [element, ...descendants(snapshot, element)].filter(e => visibleText(snapshot, e)).map(e => e.ownText).join(" ").trim().replace(/\s+/g, " ")
		const height = element.rect.height / snapshot.viewport.height
		const area = element.rect.width * element.rect.height / (snapshot.viewport.width * snapshot.viewport.height)
		if (text.length < 40 || (height < 0.28 && area < 0.25)) return []
		return [{ element, message: `Long display headline occupies ${Math.round(height * 100)}% of viewport height`, snippet: shortSnippet(element) }]
	}),
}
