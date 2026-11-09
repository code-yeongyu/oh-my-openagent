import type { PageRule } from "../../rule"
import { pageText } from "./support/page-text"

const HEADS = [
	"accessibility", "accountability", "agile", "alignment", "compliance", "diversity", "engagement", "governance", "growth",
	"hiring", "hygiene", "innovation", "inclusion", "kindness", "leadership", "metrics", "privacy", "process", "productivity",
	"quality", "safety", "security", "strategy", "sustainability", "transparency", "trust", "wellness",
] as const

export const theaterSlopPhrase: PageRule = {
	meta: {
		id: "theater-slop-phrase", name: "Theater framing copy", category: "slop", severity: "advisory", engine: "page",
		description: "Calling a practice theater dismisses it without explaining the defect.",
		fixHint: "Describe the missing behavior or evidence instead of dismissing it as theater.",
	},
	check: ({ snapshot }) => {
		const match = [...pageText(snapshot).matchAll(/\b(\w+)\s+theater\b/gi)]
			.find((m) => HEADS.some((head) => head === m[1]?.toLowerCase()))
		return match ? [{ element: null, message: "Dismissive theater framing", snippet: match[0] }] : []
	},
}
