import { fontSizePx, px, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { cjk, visibleText } from "./support/text-context"

export const extremeNegativeTracking: PageRule = {
	meta: {
		id: "extreme-negative-tracking", name: "Crushed letter spacing", category: "slop", severity: "warning", engine: "page",
		description: "Negative tracking beyond the reading or display threshold damages letter shapes.",
		fixHint: "Keep tracking at or above -0.07em for reading text and -0.09em for display type.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		const size = fontSizePx(element)
		const tracking = (px(styleOf(element, "letter-spacing")) ?? 0) / size
		if (visibleText(snapshot, element) === false || element.ownText.length <= 10 || element.text.length <= 20 ||
			size <= 0 || tracking >= (size >= 40 ? -0.09 : -0.07) || cjk(element.text)) return []
		return [{ element, message: `Letter spacing ${tracking.toFixed(2)}em at ${size}px`, snippet: shortSnippet(element) }]
	}),
}
