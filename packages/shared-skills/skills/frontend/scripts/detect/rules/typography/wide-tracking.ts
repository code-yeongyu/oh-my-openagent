import { fontSizePx, px, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { caps, cjk, letters, lineage, visibleText } from "./support/text-context"
import { shownLines } from "./support/text-lines"

export const wideTracking: PageRule = {
	meta: {
		id: "wide-tracking", name: "Wide letter spacing on body text", category: "quality", severity: "warning", engine: "page",
		description: "Widely tracked reading text splits words into individual characters.",
		fixHint: "Keep body tracking at or below 0.05em; reserve wider spacing for capital labels.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		const size = fontSizePx(element)
		if (visibleText(snapshot, element) === false || element.ownText.length <= 10 || element.text.length <= 20 ||
			size <= 0 || (px(styleOf(element, "letter-spacing")) ?? 0) / size <= 0.05) return []
		const transform = styleOf(element, "text-transform")
		const count = shownLines(snapshot, element, px(styleOf(element, "line-height")) ?? size * 1.2)
		const capsLabel = transform === "uppercase" || (transform !== "lowercase" && caps(element.text) &&
			(element.text.length < 80 || (letters(element.text).length <= 40 && count <= 1)))
		const trackedControl = lineage(snapshot, element).some(n => n.tag === "button" ||
			(n.tag === "a" && n.attributes["href"] !== undefined) ||
			["button", "link", "tab"].includes(n.attributes["role"] ?? ""))
		if (capsLabel || (trackedControl && letters(element.text).length <= 40 && count <= 1) || cjk(element.ownText)) return []
		return [{ element, message: "Letter spacing exceeds 0.05em on reading text", snippet: shortSnippet(element) }]
	}),
}
