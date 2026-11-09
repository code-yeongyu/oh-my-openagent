import { childrenOf, fontSizePx, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { control, finePrintExempt, readingTags, visibleText } from "./support/text-context"
import { mergedLines, phrasingNodes, renderedCharacters } from "./support/text-lines"

export const lineLength: PageRule = {
	meta: {
		id: "line-length", name: "Line length too long", category: "quality", severity: "warning", engine: "page",
		description: "Multiple rendered lines longer than 80 characters make return sweeps difficult.",
		fixHint: "Constrain reading copy to a max-width around 65ch to 75ch.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		if (visibleText(snapshot, element) === false || finePrintExempt(snapshot, element)) return []
		const generic = ["div", "section", "article", "aside", "main"].includes(element.tag) &&
			element.ownText.length > 10 && fontSizePx(element) < 24 &&
			["block", "flow-root"].includes(styleOf(element, "display")) &&
			styleOf(element, "white-space").startsWith("pre") === false && control(snapshot, element) === false &&
			childrenOf(snapshot, element).every(n => ["inline", "contents"].includes(styleOf(n, "display")) || ["br", "wbr"].includes(n.tag))
		if (readingTags.includes(element.tag) === false && generic === false) return []
		const nodes = phrasingNodes(snapshot, element)
		const count = renderedCharacters(nodes)
		if (count <= 80) return []
		const lines = mergedLines(nodes)
		const total = lines.reduce((n, l) => n + l.width, 0)
		if (total <= 0 || lines.filter(l => count * l.width / total > 85).length < 2) return []
		return [{ element, message: `Rendered lines exceed 80 characters (${Math.round(count * Math.max(...lines.map(l => l.width)) / total)} at widest)`, snippet: shortSnippet(element) }]
	}),
}
