import { isRendered, shortSnippet, styleOf } from "../../core/page"
import { parseShadow } from "../../core/shadow"
import type { PageRule } from "../../rule"

const MIN_OFFSET_PX = 4

export const hardOffsetShadow: PageRule = {
	meta: {
		id: "hard-offset-shadow",
		name: "Hard offset shadow",
		category: "quality",
		severity: "advisory",
		engine: "page",
		description: "A visible shadow displaced by 4px or more with no blur: a neobrutalist costume unless the brief chose that direction.",
		fixHint: "Use an elevation shadow with a y-offset and a soft blur, or waive it with data-detect-ignore=\"hard-offset-shadow\" when neobrutalism is the brief.",
	},
	check: ({ snapshot }) =>
		snapshot.elements.flatMap((el) => {
			if (!isRendered(snapshot, el)) return []
			const hard = parseShadow(styleOf(el, "box-shadow")).find(
				(l) =>
					!l.inset &&
					l.color.a > 0 &&
					l.blur === 0 &&
					Math.max(Math.abs(l.x), Math.abs(l.y)) >= MIN_OFFSET_PX &&
					l.spread > -Math.max(Math.abs(l.x), Math.abs(l.y)),
			)
			if (!hard) return []
			return [{ element: el, message: `box-shadow ${hard.x}px ${hard.y}px with no blur`, snippet: shortSnippet(el) }]
		}),
}
