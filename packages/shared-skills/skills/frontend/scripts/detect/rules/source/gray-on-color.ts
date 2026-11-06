import type { SourceRule } from "../../rule"
import { exclusiveScopes, solidBackground, tagAt } from "./support/markup-scope"
import { lineCheck, sourceExtensions } from "./support/source-text"

export const grayOnColor: SourceRule = {
	meta: { id: "gray-on-color", name: "Gray text on colored background", category: "quality", severity: "warning", engine: "source", description: "Gray utility text shares an element and conditional branch with a solid colored fill.", fixHint: "Use ink derived from the surface hue, or a neutral surface." },
	extensions: sourceExtensions,
	check: lineCheck([/\btext-(?:gray|slate|zinc|neutral|stone)-(\d+)\b/g], ({ match, line }) => {
		if (Number(match[1]) >= 700) return null
		const bg = exclusiveScopes(tagAt(line, match.index ?? 0)).filter((scope) => scope.includes(match[0])).map((scope) => solidBackground(scope, true)).find((value) => value !== null)
		return bg ? `${match[0]} on ${bg}` : null
	}),
}
