import type { SourceRule } from "../../rule"
import { lineCheck, sourceExtensions } from "./support/source-text"

export const gradientText: SourceRule = {
	meta: { id: "gradient-text", name: "Gradient text", category: "slop", severity: "warning", engine: "source", description: "Clipped text uses a decorative gradient fill.", fixHint: "Use a solid text color with a clear hierarchy." },
	extensions: sourceExtensions,
	check: lineCheck([/(?:-webkit-)?background-clip\s*:\s*text/gi, /\bbg-clip-text\b/g], ({ match, scope }) => {
		if (match[0] === "bg-clip-text") return /\bbg-gradient-to-/i.test(scope) ? "bg-clip-text + bg-gradient" : null
		return /gradient/i.test(scope) ? "background-clip: text + gradient" : null
	}),
}
