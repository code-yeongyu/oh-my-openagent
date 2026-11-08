import type { PageRule } from "../../rule"
import { pageText } from "./support/page-text"

const PHRASES = [
	"streamline your", "empower your", "supercharge your", "unleash your", "unleash the power", "leverage the power",
	"built for the modern", "trusted by leading", "trusted by the world", "best-in-class", "industry-leading",
	"world-class", "enterprise-grade", "next-generation", "cutting-edge", "transform your business", "revolutionize",
	"game-changer", "game changing", "mission-critical", "best of breed", "future-proof", "future proof",
	"seamless experience", "seamlessly integrate", "drive engagement", "drive growth", "drive results", "harness the power",
] as const

export const marketingBuzzword: PageRule = {
	meta: {
		id: "marketing-buzzword", name: "Marketing buzzword", category: "slop", severity: "warning", engine: "page",
		description: "Generic promotion replaces a concrete description of the product.",
		fixHint: "Name the action, benefit or measured result instead of a stock marketing phrase.",
	},
	check: ({ snapshot }) => {
		const text = pageText(snapshot)
		const lower = text.toLowerCase()
		let count = 0
		let sample = ""
		for (const phrase of PHRASES) {
			let from = 0
			for (let at = lower.indexOf(phrase, from); at >= 0; at = lower.indexOf(phrase, from)) {
				count++
				if (sample === "") sample = text.slice(Math.max(0, at - 12), at + phrase.length + 12).trim()
				from = at + phrase.length
			}
		}
		return count === 0 ? [] : [{ element: null, message: `${count} buzzword phrases`, snippet: sample }]
	},
}
