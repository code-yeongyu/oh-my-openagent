import { shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { buttonBox, caps, finePrintExempt, mono, smallprint, uiContext, visibleText } from "./support/text-context"
import { drawnFontSize } from "./support/svg-size"
import { textPainted } from "./support/painted-text"

export const tinyText: PageRule = {
	meta: {
		id: "tiny-text", name: "Tiny body text", category: "quality", severity: "warning", engine: "page",
		description: "Running copy smaller than 12px is difficult to read.",
		fixHint: "Increase body copy to at least 14px, preferably 16px.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		if (visibleText(snapshot, element) === false || !textPainted(snapshot, element) || element.ownText.length <= 10 || element.text.length <= 20 ||
			drawnFontSize(snapshot, element) >= 12 ||
			["sub", "sup", "code", "kbd", "samp", "var", "caption", "figcaption"].includes(element.tag) ||
			uiContext(snapshot, element) || (buttonBox(snapshot, element) && smallprint(snapshot, element) === false) || finePrintExempt(snapshot, element) ||
			styleOf(element, "text-transform") === "uppercase" ||
			(element.text.length < 80 && caps(element.text)) ||
			(mono(element) && styleOf(element, "white-space").startsWith("pre"))) return []
		return [{ element, message: `${drawnFontSize(snapshot, element).toFixed(2)}px body text`, snippet: shortSnippet(element) }]
	}),
}
