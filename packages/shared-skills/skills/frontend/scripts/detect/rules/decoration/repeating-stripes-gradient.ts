import type { PageRule } from "../../rule"
import { shortSnippet } from "../../core/page"
import { visible } from "./support/appearance"
import { repeats } from "./support/gradient-pattern"
export const repeatingStripesGradient: PageRule = {
	meta: {
		id: "repeating-stripes-gradient",
		name: "Repeating-gradient stripes",
		category: "slop",
		severity: "advisory",
		engine: "page",
		description: "Repeating gradient bands decorate a surface without adding structure.",
		fixHint: "Use a deliberate texture or keep the surface plain.",
	},
	check: ({ snapshot }) => {
		const e = snapshot.elements.find(
			(e) =>
				visible(snapshot, e) &&
				[e.style, e.before?.style, e.after?.style].some((s) =>
					["background-image", "mask-image", "-webkit-mask-image"].some((p) => repeats(s?.[p] ?? "")),
				),
		)
		return e ? [{ element: e, message: "Repeating gradient surface stripes", snippet: shortSnippet(e) }] : []
	},
}
