import { descendants } from "../../core/page"
import type { PageRule } from "../../rule"
import { labelBefore, labelContext, labelType, parsedIndex, styledLabel } from "./support/numbered-label"

export const numberedSectionLabels: PageRule = {
	meta: {
		id: "numbered-section-labels", name: "Tiny numbered section labels", category: "slop", severity: "advisory", engine: "page",
		description: "Multiple headings carry tiny styled numeric indices that add scaffolding rather than information.",
		fixHint: "Remove decorative section numbers or make necessary numbering part of the heading.",
	},
	check: ({ snapshot }) => {
		const seen = new Set<number>()
		const candidates = snapshot.elements.flatMap((heading) => {
			if (!["h2", "h3", "h4"].includes(heading.tag) || heading.text.length < 3) return []
			const label = labelBefore(snapshot, heading)
			if (!label || seen.has(label.index) || !labelContext(snapshot, heading, label) || !labelContext(snapshot, label, heading)
				|| !["span", "p", "div", "small", "em", "strong", "b"].includes(label.tag)) return []
			const text = (label.ownText || label.text).replace(/\s+/g, " ").trim()
			const index = parsedIndex(text)
			if (index === null || !styledLabel(labelType(snapshot, label), heading)) return []
			if ([...descendants(snapshot, label)].some((el) => ["img", "picture", "video", "canvas"].includes(el.tag)
				|| el.tag === "svg" && snapshot.elements[el.parent ?? -1]?.ownText.match(/^\d{2}$/))) return []
			seen.add(label.index)
			return [{ label, heading, text, index }]
		})
		const hashWords = candidates.filter((c) => c.text.startsWith("#")).map((c) => /^#\d+\s+(\S+)/.exec(c.text)?.[1]?.toLowerCase())
		const matchingHashes = hashWords.length >= 2 && hashWords[0] !== undefined && hashWords.every((w) => w === hashWords[0])
		const filtered = matchingHashes ? candidates.filter((c) => !c.text.startsWith("#")) : candidates
		if (filtered.length < 2 || new Set(filtered.map((c) => c.index)).size < 2) return []
		return filtered.map(({ label, heading, text }) => ({
			element: label, message: `${filtered.length} tiny numeric labels beside section headings`, snippet: `${text.slice(0, 24)} / ${heading.text.slice(0, 60)}`,
		}))
	},
}
