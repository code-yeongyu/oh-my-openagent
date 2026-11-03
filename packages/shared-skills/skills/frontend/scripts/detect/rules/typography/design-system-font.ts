import { shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { normalizeFont, primaryFont } from "./support/font-family"
import { visibleText } from "./support/text-context"

export const designSystemFont: PageRule = {
	meta: {
		id: "design-system-font", name: "Font outside DESIGN.md", category: "quality", severity: "warning", engine: "page",
		description: "A text face is absent from the configured typography tokens.",
		fixHint: "Use a configured font token or add the intentional face to designTokens.fonts.",
	},
	check: ({ snapshot, config }) => {
		const allowed = config.designTokens?.fonts?.map(normalizeFont)
		if (allowed === undefined || allowed.length === 0) return []
		const seen = new Set<string>()
		return snapshot.elements.flatMap(element => {
			const family = primaryFont(styleOf(element, "font-family"), true)
			if (visibleText(snapshot, element) === false || element.ownText.trim() === "" ||
				family === "" || allowed.includes(family) || seen.has(family)) return []
			seen.add(family)
			return [{ element, message: `Font ${family} is outside configured tokens`, snippet: shortSnippet(element) }]
		})
	},
}
