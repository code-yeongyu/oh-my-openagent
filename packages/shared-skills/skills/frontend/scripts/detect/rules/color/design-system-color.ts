import { parseColor } from "../../core/color"
import { isRendered, px, shortSnippet, styleOf } from "../../core/page"
import type { PageHit, PageRule } from "../../rule"
import { colorDistance } from "./support/gradients"

export const designSystemColor: PageRule = {
	meta: {
		id: "design-system-color", name: "Color outside DESIGN.md", category: "quality", severity: "advisory", engine: "page",
		description: "A painted color is outside the project's declared palette.",
		fixHint: "Use a declared color token or add the intentional color to the palette.",
	},
	check: ({ snapshot, config }) => {
		const tokens = config.designTokens?.colors?.map(parseColor).filter((c) => c !== null) ?? []
		if (tokens.length === 0) return []
		const seen = new Set<string>()
		const hits: PageHit[] = []
		for (const el of snapshot.elements) {
			if (!isRendered(snapshot, el) || ["head", "title", "meta", "link", "style", "script", "noscript", "template", "source"].includes(el.tag)) continue
			const props = ["background-color"]
			if (el.ownText.trim() !== "") props.push("color")
			for (const side of ["top", "right", "bottom", "left"]) if ((px(styleOf(el, `border-${side}-width`)) ?? 0) > 0) props.push(`border-${side}-color`)
			if ((px(styleOf(el, "outline-width")) ?? 0) > 0) props.push("outline-color")
			for (const prop of props) {
				const raw = styleOf(el, prop)
				const c = parseColor(raw)
				if (!c || c.a <= 0.05 || tokens.some((token) => colorDistance(c, token) <= 6)) continue
				const key = `${prop}:${raw}`
				if (seen.has(key)) continue
				seen.add(key)
				hits.push({ element: el, message: `${prop} ${raw} is outside the declared palette`, snippet: shortSnippet(el) })
			}
		}
		return hits
	},
}
