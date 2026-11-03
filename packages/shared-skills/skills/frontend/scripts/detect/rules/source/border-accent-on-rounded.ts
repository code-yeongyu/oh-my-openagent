import type { SourceRule } from "../../rule"
import { cssScopes, selectorHost, selectorMatches } from "./support/css-scopes"
import { tagAt } from "./support/markup-scope"
import { lineCheck, sourceExtensions } from "./support/source-text"

export const borderAccentOnRounded: SourceRule = {
	meta: { id: "border-accent-on-rounded", name: "Border accent on rounded element", category: "slop", severity: "warning", engine: "source", description: "A thick top or bottom border meets a rounded element.", fixHint: "Remove the accent border or use square corners." },
	extensions: sourceExtensions,
	check: lineCheck([/\bborder-[tb]-(\d+)\b/g, /border-(?:top|bottom)\s*:\s*(\d+)px\s+solid/gi], ({ match, line, scope, offset, pass }) => {
		if (match[0].startsWith("border-t-") || match[0].startsWith("border-b-")) {
			const tag = tagAt(line, match.index ?? 0)
			return Number(match[1]) >= 1 && /\brounded(?!-none\b)(?:-\w+)?\b/.test(tag) && !/\banimate-spin\b/.test(tag) ? match[0] : null
		}
		if (Number(match[1]) < 3) return null
		const scopes = cssScopes(pass.text, pass.sass)
		const own = scopes.filter((s) => s.start <= offset && offset <= s.end).sort((a, b) => b.start - a.start)[0]
		const radius = own ? scopes.some((s) => selectorMatches(selectorHost(s), selectorHost(own)) && /(?:^|[;{\s])border[-\w]*radius\s*:/.test(s.body)) : /border-radius/i.test(scope)
		return radius ? match[0] : null
	}),
}
