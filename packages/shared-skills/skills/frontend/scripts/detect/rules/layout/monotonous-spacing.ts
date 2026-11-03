import type { PageRule } from "../../rule"

export const monotonousSpacing: PageRule = {
	meta: {
		id: "monotonous-spacing", name: "Monotonous spacing", category: "slop", severity: "warning", engine: "page",
		description: "One spacing value dominates the page instead of separating related groups from sections.",
		fixHint: "Keep related items close and give separate sections a larger gap.",
	},
	check: ({ snapshot }) => {
		const values: number[] = []
		const css = [...snapshot.cssText, ...snapshot.elements.map((el) => el.attributes["style"] ?? "")].join("\n")
		for (const m of css.matchAll(/(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*(\d+)px/gi)) {
			const v = Number(m[1])
			if (v > 0 && v < 200) values.push(v)
		}
		for (const m of css.matchAll(/(?:gap|row-gap|column-gap)\s*:\s*(\d+)px/gi)) values.push(Number(m[1]))
		for (const el of snapshot.elements) {
			for (const m of (el.attributes["class"] ?? "").matchAll(/\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-(\d+)\b/g)) values.push(Number(m[1]) * 4)
		}
		for (const m of css.matchAll(/(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*(\d*\.?\d+)rem/gi)) {
			const v = Math.round(Number(m[1]) * 16)
			if (v > 0 && v < 200) values.push(v)
		}
		const rounded = values.map((v) => Math.round(v / 4) * 4)
		if (rounded.length < 10) return []
		const counts = new Map<number, number>()
		for (const v of rounded) counts.set(v, (counts.get(v) ?? 0) + 1)
		const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]
		if (!dominant || dominant[0] === 0 || dominant[1] / rounded.length <= 0.6 || [...counts.keys()].filter((v) => v > 0).length > 3) return []
		return [{ element: null, message: `${dominant[0]}px accounts for ${dominant[1]} of ${rounded.length} spacing declarations.`, snippet: `${Math.round(dominant[1] / rounded.length * 100)}% repeated spacing` }]
	},
}
