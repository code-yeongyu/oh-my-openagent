import { isHeading, shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"
import { measuredLines, oneFace, wordsOf, wrapIs } from "./support/line-breaks"

export const unbalancedHeading: PageRule = {
	meta: {
		id: "unbalanced-heading", name: "Unbalanced heading", category: "quality", severity: "advisory", engine: "page",
		description: "The last line of a heading is much shorter than the line above.",
		fixHint: "Use text-wrap: balance or rewrite the heading to keep its lines near even.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		if (!isHeading(el) || wrapIs(el, "balance") || wordsOf(el).length < 3) return []
		const lines = measuredLines(snapshot, el)
		const tail = lines.at(-1)
		const above = lines.at(-2)
		if (lines.length < 2 || lines.length > 3 || !tail || !above || tail.width >= above.width * 0.35) return []
		const widest = Math.max(...lines.map((l) => l.width))
		const total = lines.reduce((n, l) => n + l.width, 0)
		if (oneFace(snapshot, el) && widest * el.text.length / total < 20) return []
		return [{ element: el, message: `The last line is ${Math.round(tail.width / above.width * 100)}% as wide as the line above.`, snippet: shortSnippet(el) }]
	}),
}
