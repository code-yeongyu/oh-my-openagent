import { fontSizePx, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { buttonBox, className, codeContext, control, furnitureClass, lineage, mono, smallprint, visibleText } from "./support/text-context"
import { textPainted } from "./support/painted-text"

export const undersizedUiText: PageRule = {
	meta: {
		id: "undersized-ui-text", name: "Undersized functional text", category: "quality", severity: "warning", engine: "page",
		description: "Functional labels below 11px are difficult to read and use.",
		fixHint: "Use at least 11px for functional text and at least 10px for noninteractive small print.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		const size = fontSizePx(element)
		const interactive = control(snapshot, element)
		const floor = interactive === false && smallprint(snapshot, element) ? 10 : 11
		const chain = lineage(snapshot, element)
		const furniture = chain.some(n => ["nav", "td", "th", "caption", "figcaption", "dt", "dd", "footer"].includes(n.tag) ||
			["navigation", "gridcell", "cell"].includes(n.attributes["role"] ?? "") ||
			(n.tag !== "html" && furnitureClass(className(n))))
		const codeRun = mono(element) && styleOf(element, "white-space").startsWith("pre") && /[{}[\]<>=;"`\\_]/.test(element.ownText)
		if (visibleText(snapshot, element) === false || !textPainted(snapshot, element) || size <= 0 || Math.round((floor - size) * 1000) < 100 ||
			element.ownText.trim().length < 2 || ["sub", "sup", "option"].includes(element.tag) ||
			chain.some(n => ["sub", "sup"].includes(n.tag)) || codeContext(snapshot, element) || codeRun ||
			(interactive === false && furniture === false &&
				(buttonBox(snapshot, element) === false || smallprint(snapshot, element)) && element.ownText.length > 20)) return []
		return [{ element, message: `${size}px functional text below ${floor}px floor`, snippet: shortSnippet(element) }]
	}),
}
