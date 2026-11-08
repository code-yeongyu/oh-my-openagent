import { parseColor, type Rgba } from "./color"

export type ShadowLayer = {
	readonly inset: boolean
	readonly color: Rgba
	readonly x: number
	readonly y: number
	readonly blur: number
	readonly spread: number
}

function splitLayers(value: string): readonly string[] {
	const layers: string[] = []
	let depth = 0
	let start = 0
	for (let i = 0; i < value.length; i++) {
		const ch = value[i]
		if (ch === "(") depth++
		else if (ch === ")") depth--
		else if (ch === "," && depth === 0) {
			layers.push(value.slice(start, i).trim())
			start = i + 1
		}
	}
	layers.push(value.slice(start).trim())
	return layers.filter(Boolean)
}

/** Parses a computed box-shadow or text-shadow value into layers; `none` yields no layers. */
export function parseShadow(value: string): readonly ShadowLayer[] {
	if (value.trim() === "" || value.trim() === "none") return []
	return splitLayers(value).flatMap((layer) => {
		const colorMatch = /(rgba?|color|oklab|oklch)\([^()]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/i.exec(layer)
		const color = (colorMatch ? parseColor(colorMatch[0]) : null) ?? { r: 0, g: 0, b: 0, a: 1 }
		const rest = colorMatch ? layer.replace(colorMatch[0], " ") : layer
		const lengths = [...rest.matchAll(/(-?\d*\.?\d+)(px)?(?=\s|$)/g)].map((m) => Number.parseFloat(m[1] ?? "0"))
		if (lengths.length < 2) return []
		return [{ inset: /\binset\b/.test(rest), color, x: lengths[0] ?? 0, y: lengths[1] ?? 0, blur: lengths[2] ?? 0, spread: lengths[3] ?? 0 }]
	})
}
