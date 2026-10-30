import { fontSizePx, shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"
import { visibleText } from "./support/text-context"

export const designSystemFontSize: PageRule = {
	meta: {
		id: "design-system-font-size", name: "Font size outside DESIGN.md", category: "quality", severity: "advisory", engine: "page",
		description: "A rendered font size is outside the configured type ramp.",
		fixHint: "Use a configured size token or add the intentional step to designTokens.fontSizes.",
	},
	check: ({ snapshot, config }) => {
		const allowed = config.designTokens?.fontSizes
		if (allowed === undefined || allowed.length === 0) return []
		const seen = new Set<number>()
		return snapshot.elements.flatMap(element => {
			const size = fontSizePx(element)
			if (visibleText(snapshot, element) === false || element.ownText.trim() === "" ||
				size <= 0 || allowed.some(n => Math.abs(n - size) <= 0.5) || seen.has(size)) return []
			seen.add(size)
			return [{ element, message: `${size}px is outside configured type ramp`, snippet: shortSnippet(element) }]
		})
	},
}
