import type { PageRule } from "../../rule"
import { shortSnippet } from "../../core/page"
import { splitTop, visible } from "./support/appearance"
export const codexGridBackground: PageRule = {
	meta: {
		id: "codex-grid-background",
		name: "Decorative grid-line background",
		category: "slop",
		severity: "advisory",
		engine: "page",
		description: "Tiled hairline gradients draw a decorative grid behind content.",
		fixHint: "Reserve grids for measurement or canvas surfaces; use a plain content background.",
	},
	check: ({ snapshot }) => {
		const e = snapshot.elements.find(
			(e) =>
				visible(snapshot, e) &&
				[e.style, e.before?.style, e.after?.style].some((s) => {
					const image = s?.["background-image"] ?? "",
						size = s?.["background-size"] ?? ""
					return (
						splitTop(image).filter(
							(layer) =>
								layer.includes("linear-gradient(") &&
								/(?:\b[0-9]{1,3}px\s*,\s*(?:transparent|rgba?\([^)]*[, /]\s*0\s*\)))|(?:transparent\s+calc\(100%\s*-\s*[0-9]{1,3}px\))/i.test(
									layer,
								),
						).length >= 2 && /\b[0-9]{1,3}px\b/.test(size)
					)
				}),
		)
		return e ? [{ element: e, message: "Tiled two-axis gradient grid", snippet: shortSnippet(e) }] : []
	},
}
