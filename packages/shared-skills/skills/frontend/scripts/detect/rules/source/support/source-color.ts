import { parseColor, type Rgba } from "../../../core/color"

const named: Readonly<Record<string, string>> = {
	black: "#000", white: "#fff", gray: "#808080", grey: "#808080", silver: "#c0c0c0", dimgray: "#696969", dimgrey: "#696969", darkgray: "#a9a9a9", darkgrey: "#a9a9a9",
	lightgray: "#d3d3d3", lightgrey: "#d3d3d3", gainsboro: "#dcdcdc", whitesmoke: "#f5f5f5", red: "#f00", blue: "#00f", green: "#008000", lime: "#0f0", yellow: "#ff0",
	orange: "#ffa500", purple: "#800080", rebeccapurple: "#663399", pink: "#ffc0cb", teal: "#008080", cyan: "#0ff", aqua: "#0ff", magenta: "#f0f", fuchsia: "#f0f", coral: "#ff7f50", crimson: "#dc143c", navy: "#000080", maroon: "#800000", olive: "#808000",
}

export function authoredColor(value: string): Rgba | null {
	const text = value.trim().toLowerCase()
	const parsed = parseColor(named[text] ?? text)
	if (parsed) return parsed
	const match = /^(hsla?|hwb)\((.*)\)$/.exec(text)
	if (!match) return null
	const parts = (match[2] ?? "").replace(/[,/]/g, " ").split(/\s+/).filter(Boolean)
	const hue = Number.parseFloat(parts[0] ?? "0") / (parts[0]?.endsWith("turn") ? 1 : parts[0]?.endsWith("rad") ? 2 * Math.PI : 360)
	const s = Number.parseFloat(parts[1] ?? "0") / 100
	const l = Number.parseFloat(parts[2] ?? "0") / 100
	const alpha = parts[3]
	const a = alpha === undefined ? 1 : Number.parseFloat(alpha) / (alpha.endsWith("%") ? 100 : 1)
	const channel = (n: number): number => {
		const k = ((n + hue * 12) % 12 + 12) % 12
		return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
	}
	if (match[1] !== "hwb") return { r: channel(0) * 255, g: channel(8) * 255, b: channel(4) * 255, a }
	if (s + l >= 1) return { r: 255 * s / (s + l), g: 255 * s / (s + l), b: 255 * s / (s + l), a }
	const pure = authoredColor(`hsl(${hue * 360} 100% 50%)`)
	return pure ? { r: pure.r * (1 - s - l) + 255 * s, g: pure.g * (1 - s - l) + 255 * s, b: pure.b * (1 - s - l) + 255 * s, a } : null
}

export function authoredColors(value: string): readonly Rgba[] {
	return [...value.matchAll(/(?:rgba?|hsla?|hwb|color|oklab|oklch)\([^()]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b/gi)].flatMap((m) => {
		const color = authoredColor(m[0])
		return color ? [color] : []
	})
}

export function chromatic(value: string): boolean {
	const color = authoredColor(value) ?? authoredColors(value)[0]
	if (color) return color.a >= 0.1 && Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) >= 30
	return !/\b(?:transparent|currentcolor|black|white|gr[ae]y|silver|gainsboro|whitesmoke)\b|url\(/i.test(value)
}
