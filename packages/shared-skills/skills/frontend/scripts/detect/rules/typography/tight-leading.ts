import { fontSizePx, px, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { caps, headingText, lineage, mono, pitch, visibleText } from "./support/text-context"
import { itemsEachFitOneLine } from "./support/flex-runs"
import { mergedLines, phrasingNodes, shownLines } from "./support/text-lines"

export const tightLeading: PageRule = {
	meta: {
		id: "tight-leading", name: "Tight line height", category: "quality", severity: "warning", engine: "page",
		description: "Multiline reading copy with line height below 1.3 crowds adjacent lines.",
		fixHint: "Use line height around 1.5 to 1.7 for body copy.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		const size = fontSizePx(element)
		const height = pitch(snapshot, element)
		const ratio = Math.round(height / size * 100) / 100
		if (visibleText(snapshot, element) === false || element.ownText.length <= 10 || element.text.length <= 50 ||
			size <= 0 || size >= 24 || height <= 0 || ratio >= 1.3 || headingText(snapshot, element)) return []
		const lines = mergedLines(phrasingNodes(snapshot, element))
		const top = lines[0]?.y
		if (top === undefined) return []
		const bottom = Math.max(...lines.map(l => l.y + l.height))
		if (bottom - top < height * 1.5) return []
		let count = shownLines(snapshot, element, height)
		let clamped = false
		for (const n of lineage(snapshot, element).slice(0, 4)) {
			const display = styleOf(n, "display")
			const clamp = Number.parseFloat(styleOf(n, "-webkit-line-clamp"))
			if (["-webkit-box", "-webkit-inline-box"].includes(display) ||
				(["flow-root", "inline-block"].includes(display) && clamp > 0)) clamped = true
			if (["hidden", "clip"].includes(styleOf(n, "overflow-y"))) {
				count = Math.min(count, Math.max(1, Math.round((n.rect.y + n.rect.height - top) / height)))
				break
			}
		}
		const weight = Number.parseFloat(styleOf(element, "font-weight"))
		if (weight >= 600 && (clamped || count <= 2)) return []
		if (size >= 20 && ratio >= 1.15 && count <= 3) return []
		if (ratio >= 1 && ((styleOf(element, "text-transform") === "uppercase" && count <= 3) ||
			(element.text.length < 80 && caps(element.text)))) return []
		const ws = styleOf(element, "white-space")
		if (mono(element) && ((ws.startsWith("pre") && ws !== "pre-line") || ws === "break-spaces") &&
			(lineage(snapshot, element).some(n => ["pre", "code", "samp"].includes(n.tag)) || /[\u2500-\u257f]/.test(element.ownText))) return []
		if (itemsEachFitOneLine(element, size)) return []
		return [{ element, message: `Line height ${(height / size).toFixed(2)}x below 1.3`, snippet: shortSnippet(element) }]
	}),
}
