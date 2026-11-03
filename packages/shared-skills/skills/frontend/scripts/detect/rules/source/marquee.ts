import type { SourceRule } from "../../rule"
import { marqueeSelectors } from "./support/css-effects"
import { componentExtensions, pageSource, sourceHit } from "./support/source-text"

export const marquee: SourceRule = {
	meta: { id: "marquee", name: "Auto-scrolling marquee", category: "slop", severity: "warning", engine: "source", description: "Content moves in a perpetual horizontal loop.", fixHint: "Keep content still or let the reader control scrolling." },
	extensions: componentExtensions,
	check: (context) => {
		const text = pageSource(context)
		return text === null ? [] : marqueeSelectors(text).map((selector) => sourceHit(text, 0, `Horizontal content loop: ${selector}`, selector))
	},
}
