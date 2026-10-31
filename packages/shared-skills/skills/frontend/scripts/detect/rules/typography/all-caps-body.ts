import { isHeading, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { visibleText } from "./support/text-context"

export const allCapsBody: PageRule = {
	meta: {
		id: "all-caps-body", name: "All-caps body text", category: "quality", severity: "warning", engine: "page",
		description: "Uppercase sentences lose the word shapes readers use to scan prose.",
		fixHint: "Set running copy in sentence case; keep uppercase for headings and short labels.",
	},
	check: ({ snapshot }) => snapshot.elements.filter(e =>
		visibleText(snapshot, e) && isHeading(e) === false && styleOf(e, "text-transform") === "uppercase" &&
		e.ownText.trim().replace(/\s+/g, " ").length >= 80)
		.map(element => ({ element, message: "Uppercase on 80 or more characters of body copy", snippet: shortSnippet(element) })),
}
