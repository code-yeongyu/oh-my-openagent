import type { SourceRule } from "../../rule"
import { darkBackground, resolveValues } from "./support/css-effects"
import { componentExtensions, pageSource, sourceHit } from "./support/source-text"
import { sourceShadows } from "./support/source-shadow"

export const darkGlow: SourceRule = {
	meta: { id: "dark-glow", name: "Glowing shadow accents", category: "slop", severity: "warning", engine: "source", description: "A colored blurred shadow creates a visible glow.", fixHint: "Use neutral elevation shadows instead of chromatic halos." },
	extensions: componentExtensions,
	check: (context) => {
		const text = pageSource(context)
		if (text === null) return []
		const dark = darkBackground(text)
		for (const m of resolveValues(text).matchAll(/(?<![-\w])(?:box|text)-shadow\s*:\s*([^;{}]+)/gi)) {
			for (const s of sourceShadows(m[1] ?? "")) {
				if (Math.max(s.color.r, s.color.g, s.color.b) - Math.min(s.color.r, s.color.g, s.color.b) < 30 || s.blur <= 4 || s.blur * s.color.a < 3 || s.blur / 2 + s.spread <= 0) continue
				if (dark || (s.x === 0 && s.y === 0)) return [sourceHit(text, m.index ?? 0, "Colored shadow glow")]
			}
		}
		return []
	},
}
