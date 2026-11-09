import type { SourceRule } from "../../rule"
import { lineCheck, sourceExtensions } from "./support/source-text"

export const aiColorPalette: SourceRule = {
	meta: { id: "ai-color-palette", name: "AI color palette", category: "slop", severity: "warning", engine: "source", description: "Purple heading ink or a purple-to-cool gradient repeats a generic palette.", fixHint: "Choose colors from the product's visual identity." },
	extensions: sourceExtensions,
	check: lineCheck([/\btext-(?:purple|violet|indigo)-(\d+)\b/g, /\bfrom-(?:purple|violet|indigo)-(\d+)\b/g], ({ match, scope }) => {
		if (match[0].startsWith("text-")) return /\btext-[2-9]xl\b|<h[1-3]/i.test(scope) ? `${match[0]} on heading` : null
		return /\bto-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-\d+\b/.test(scope) ? `${match[0]} gradient` : null
	}),
}
