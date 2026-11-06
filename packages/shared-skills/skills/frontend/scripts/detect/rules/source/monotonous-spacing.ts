import type { SourceRule } from "../../rule"
import { pageSource, sourceHit, componentExtensions } from "./support/source-text"

export const monotonousSpacing: SourceRule = {
	meta: { id: "monotonous-spacing", name: "Monotonous spacing", category: "slop", severity: "warning", engine: "source", description: "One spacing value dominates a full page with little variation.", fixHint: "Vary spacing to distinguish groups from sections." },
	extensions: componentExtensions,
	check: (context) => {
		const text = pageSource(context)
		if (text === null) return []
		const vals: number[] = []
		for (const m of text.matchAll(/(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*(\d+)px/gi)) { const v = Number(m[1]); if (v > 0 && v < 200) vals.push(v) }
		for (const m of text.matchAll(/(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*([\d.]+)rem/gi)) { const v = Math.round(Number(m[1]) * 16); if (v > 0 && v < 200) vals.push(v) }
		for (const m of text.matchAll(/gap\s*:\s*(\d+)px/gi)) vals.push(Number(m[1]))
		for (const m of text.matchAll(/\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-(\d+)\b/g)) vals.push(Number(m[1]) * 4)
		if (vals.length < 10) return []
		const counts = new Map<number, number>()
		for (const value of vals) { const v = Math.round(value / 4) * 4; counts.set(v, (counts.get(v) ?? 0) + 1) }
		const [dominant, count] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [0, 0]
		if (dominant === 0 || count / vals.length <= 0.6 || [...counts.keys()].filter((v) => v > 0).length > 3) return []
		return [sourceHit(text, 0, `${dominant}px appears ${count}/${vals.length} times`)]
	},
}
