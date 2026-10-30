import { ancestors, fontSizePx, px, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

const uniformScale = (value: string): number | null => {
	if (value === "" || value === "none") return 1
	if (/skew|matrix3d|rotate[XY]|perspective/i.test(value)) return null
	const matrix = /^matrix\(([^)]+)\)$/.exec(value)
	if (matrix?.[1]) {
		const [a, b, c, d] = matrix[1].split(/[\s,]+/).map(Number)
		if (a === undefined || b === undefined || c === undefined || d === undefined) return null
		const x = Math.hypot(a, b)
		const y = Math.hypot(c, d)
		return Math.abs(x - y) < 0.001 && Math.abs(a * c + b * d) < 0.001 ? x : null
	}
	let scale = 1
	for (const match of value.matchAll(/scale\(([^)]+)\)/g)) {
		const [x, y] = (match[1] ?? "").split(/[\s,]+/).map(Number)
		if (x === undefined || (y !== undefined && Math.abs(x - y) > 0.001)) return null
		scale *= Math.abs(x)
	}
	return scale
}

export function drawnFontSize(s: PageSnapshot, e: ElementSnapshot): number {
	const size = fontSizePx(e)
	if (["text", "tspan", "textpath"].includes(e.tag) === false) return size
	const chain = [e, ...ancestors(s, e)]
	const svg = chain.find(n => n.tag === "svg")
	if (svg === undefined) return size
	const box = (svg.attributes["viewBox"] ?? svg.attributes["viewbox"] ?? "").trim().split(/[\s,]+/).map(Number)
	const vw = box[2]
	const vh = box[3]
	if (box.length !== 4 || vw === undefined || vh === undefined || vw <= 0 || vh <= 0) return size
	let inner = 1
	for (const n of chain) {
		if (n === svg) break
		const computed = styleOf(n, "transform")
		const scale = uniformScale(computed === "" || computed === "none" ? n.attributes["transform"] ?? "" : computed)
		if (scale === null) return size
		inner *= scale
	}
	const content = (axis: "width" | "height", sides: readonly string[]): number | null => {
		const drawn = svg.rect[axis]
		const inset = sides.reduce((n, p) => n + (px(styleOf(svg, p)) ?? 0), 0)
		if (inset <= 0) return drawn
		const css = px(styleOf(svg, axis)) ?? 0
		if (Math.abs(css + inset - drawn) <= 1) return css
		if (Math.abs(css - drawn) <= 1) return css - inset
		return null
	}
	const w = content("width", ["padding-left", "padding-right", "border-left-width", "border-right-width"])
	const h = content("height", ["padding-top", "padding-bottom", "border-top-width", "border-bottom-width"])
	if (w === null || h === null || w <= 0 || h <= 0) return size
	const aspect = svg.attributes["preserveAspectRatio"] ?? svg.attributes["preserveaspectratio"] ?? ""
	const scale = aspect.includes("none") ? h / vh : aspect.includes("slice") ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh)
	return size * scale * inner
}
