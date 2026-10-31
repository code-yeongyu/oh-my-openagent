import { EM_DASH } from "../../core/characters"
import type { SourceRule } from "../../rule"
import { bodyText, componentExtensions, pageSource, sourceHit } from "./support/source-text"

export const emDashOveruse: SourceRule = {
	meta: { id: "em-dash-overuse", name: "Em-dash overuse", category: "slop", severity: "advisory", engine: "source", description: "Body copy repeatedly uses em dashes in a short space.", fixHint: "Break repeated asides into sentences or use simpler punctuation." },
	extensions: componentExtensions,
	check: (context) => {
		const source = pageSource(context)
		if (source === null) return []
		const text = bodyText(source).replace(/&mdash;|&#0*8212;|&#x0*2014;/gi, EM_DASH)
		const count = [...text.matchAll(/\u2014|(?<!-)--(?!-)/g)].length
		return count >= 8 && text.length <= count * 500 ? [sourceHit(source, 0, `${count} em dashes in body copy`)] : []
	},
}
