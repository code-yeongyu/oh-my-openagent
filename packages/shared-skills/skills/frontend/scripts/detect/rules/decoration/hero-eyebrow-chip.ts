import type { PageRule } from "../../rule"
import { shortSnippet } from "../../core/page"
import { heroLabel } from "./support/labels"
export const heroEyebrowChip: PageRule = {
	meta: {
		id: "hero-eyebrow-chip",
		name: "Hero eyebrow / pill chip",
		category: "slop",
		severity: "warning",
		engine: "page",
		description: "A tiny tracked or accented label decorates a display hero heading.",
		fixHint: "Remove the eyebrow or integrate its words into the heading.",
	},
	check: ({ snapshot }) =>
		snapshot.elements.flatMap((h) => {
			const label = heroLabel(snapshot, h)
			return label ? [{ element: h, message: "Small decorative eyebrow above the hero heading", snippet: shortSnippet(h) }] : []
		}),
}
