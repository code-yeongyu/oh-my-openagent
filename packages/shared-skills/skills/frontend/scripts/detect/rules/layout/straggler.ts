import { shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"
import { measuredLines, oneFace, wordsOf, wrapIs } from "./support/line-breaks"

export const straggler: PageRule = {
	meta: {
		id: "straggler", name: "Straggler", category: "quality", severity: "advisory", engine: "page",
		description: "A paragraph leaves one short word on its last line.",
		fixHint: "Use text-wrap: pretty or edit the ending so the last line has company.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		if (!["p", "li", "dd", "blockquote", "figcaption"].includes(el.tag) || wrapIs(el, "pretty") || !oneFace(snapshot, el)) return []
		const lines = measuredLines(snapshot, el)
		const tail = lines.at(-1)
		const words = wordsOf(el)
		const last = words.at(-1)
		const before = words.at(-2)
		if (lines.length < 2 || !tail || !last || !before || words.length < 3 ||
			/[\u3000-\u9fff\uac00-\ud7af]/.test(el.text) || lines.length <= 6 && wrapIs(el, "balance")) return []
		const widest = Math.max(...lines.map((l) => l.width))
		const sum = lines.reduce((n, l) => n + l.width, 0)
		const perPx = el.text.replace(/[\u00ad\u200b]/g, "").length / sum
		if (tail.width > widest * 0.3 || widest * perPx < 30 || el.text.endsWith(`${before}\u00a0${last}`)) return []
		const tailChars = tail.width * perPx
		if (tailChars > last.length + 1.5 || tailChars >= last.length + before.length + 1) return []
		return [{ element: el, message: `"${last}" appears alone on the last of ${lines.length} lines.`, snippet: shortSnippet(el) }]
	}),
}
