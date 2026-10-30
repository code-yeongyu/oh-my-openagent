import { ancestors, fontSizePx, px, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { letters, visibleText } from "./support/text-context"
import { mergedLines, phrasingNodes } from "./support/text-lines"

export const justifiedText: PageRule = {
	meta: {
		id: "justified-text", name: "Justified text", category: "quality", severity: "warning", engine: "page",
		description: "Narrow justified columns without automatic hyphenation stretch word spaces into gaps.",
		fixHint: "Align text left, widen the column, or enable hyphens: auto.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		if (visibleText(snapshot, element) === false || element.ownText.length <= 10 ||
			styleOf(element, "text-align") !== "justify" || styleOf(element, "hyphens") === "auto") return []
		let block = element
		if (styleOf(element, "display") === "inline") {
			const ancestor = [...ancestors(snapshot, element)].find(n => ["inline", "contents"].includes(styleOf(n, "display")) === false)
			if (ancestor === undefined || ancestor.ownText.length > 10) return []
			block = ancestor
		}
		const size = fontSizePx(element)
		if (size <= 0 || block.rect.width <= 0 || block.rect.width / (size * 0.5) > 45) return []
		const lines = mergedLines(phrasingNodes(snapshot, block))
		const first = lines[0]
		if (first && Math.max(...lines.map(l => l.y + l.height)) - first.y <
			(px(styleOf(block, "line-height")) ?? size * 1.2) + size * 0.75) return []
		const chars = letters([...element.ownText].slice(0, 400).join(""))
		const exempt = chars.filter(c => /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u0e00-\u0e7f\u1100-\u11ff\u2e80-\u9fff\ua960-\ud7ff\uf900-\ufaff\ufb50-\ufdff\ufe70-\ufeff\uff66-\uff9f\u{20000}-\u{3134f}]/u.test(c)).length
		if (exempt * 2 > chars.length) return []
		return [{ element, message: "Narrow justified text without automatic hyphenation", snippet: shortSnippet(element) }]
	}),
}
