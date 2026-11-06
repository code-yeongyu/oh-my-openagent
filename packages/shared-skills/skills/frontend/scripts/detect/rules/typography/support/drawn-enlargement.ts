import { ancestors, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

function rotation(value: string): number | null {
	if (value === "" || value === "none") return 0
	const parts = value.toLowerCase().trim().split(/\s+/)
	const angle = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === "z" ? parts[1] :
		parts.length === 4 && Number(parts[0]) === 0 && Number(parts[1]) === 0 && Number(parts[2]) > 0 ? parts[3] : undefined
	const match = /^([-+]?[\d.]+)(deg|grad|rad|turn)$/.exec(angle ?? "")
	if (!match) return null
	const factor = match[2] === "deg" ? Math.PI / 180 : match[2] === "grad" ? Math.PI / 200 : match[2] === "turn" ? Math.PI * 2 : 1
	const turn = Number(match[1]) * factor
	return Number.isFinite(turn) ? turn : null
}

export function drawnEnlargement(s: PageSnapshot, e: ElementSnapshot): number | null {
	const chain = [e, ...ancestors(s, e)]
	if (chain.length > 64 || chain.some(n => n.style["scale"] === undefined || n.style["rotate"] === undefined)) return null
	let a = 1, b = 0, c = 0, d = 1
	const multiply = (x: number, y: number, z: number, w: number): void => {
		const nextA = x * a + z * b, nextB = y * a + w * b
		const nextC = x * c + z * d, nextD = y * c + w * d
		a = nextA; b = nextB; c = nextC; d = nextD
	}
	for (const n of chain) {
		const transform = styleOf(n, "transform")
		if (transform !== "" && transform !== "none") {
			const matrix = /^matrix\(([^)]+)\)$/.exec(transform)
			if (!matrix) return null
			const values = (matrix[1] ?? "").split(",").map(Number)
			const [x, y, z, w] = values
			if (values.length !== 6 || x === undefined || y === undefined || z === undefined || w === undefined || !values.every(Number.isFinite)) return null
			multiply(x, y, z, w)
		}
		const scale = styleOf(n, "scale")
		if (scale !== "" && scale !== "none") {
			const values = scale.trim().split(/\s+/).map(v => v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v))
			const x = values[0], y = values[1] ?? x
			if (values.length > 3 || x === undefined || y === undefined || !values.every(Number.isFinite)) return null
			multiply(x, 0, 0, y)
		}
		const angle = rotation(styleOf(n, "rotate"))
		if (angle === null) return null
		multiply(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle))
	}
	const scale = Math.min(Math.hypot(a, b), Math.hypot(c, d))
	return Number.isFinite(scale) && scale > 1.05 ? scale : 1
}
