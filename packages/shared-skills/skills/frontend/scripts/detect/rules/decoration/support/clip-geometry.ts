import { splitTop } from "./appearance"
import { arc, cubic, lerp, type Point } from "./curve-samples"
export function geometricPolygon(body: string): boolean {
	const points = splitTop(body)
		.filter((p) => !/^nonzero$|^evenodd$/.test(p))
		.map((p) => splitTop(p, /\s/))
	const key = (v: string): string => (/^[-+]?0(?:\.0+)?(?:%|px)?$/.test(v) ? "0" : v.replace(/\s/g, ""))
	if (
		points.every((p, i) => {
			const next = points[(i + 1) % points.length]
			return p.length === 2 && next !== undefined && (key(p[0] ?? "") === key(next[0] ?? "") || key(p[1] ?? "") === key(next[1] ?? ""))
		})
	)
		return true
	const numeric = points.map((p) => p.map((v) => (/^[-+]?[\d.]+(?:px|%)?$/.test(v) ? Number.parseFloat(v) : Number.NaN)))
	if (numeric.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) return false
	const xs = numeric.map((p) => p[0] ?? 0),
		ys = numeric.map((p) => p[1] ?? 0)
	const distinct = (vs: readonly number[]): number[] => [...new Set(vs)].sort((a, b) => a - b)
	const teeth = (along: readonly number[], across: readonly number[]): boolean => {
		const d = distinct(along),
			step = (d[1] ?? 0) - (d[0] ?? 0)
		if (d.length < 3 || step <= 0 || d.slice(1).some((v, i) => Math.abs(v - (d[i] ?? 0) - step) > 0.5)) return false
		let last: number | null = null,
			swings = 0
		for (let i = 0; i < along.length; i++) {
			const j = (i + 1) % along.length
			if (Math.abs(Math.abs((along[j] ?? 0) - (along[i] ?? 0)) - step) > 0.5) {
				last = null
				continue
			}
			const swing = (across[j] ?? 0) - (across[i] ?? 0)
			if (Math.abs(swing) < 0.01) continue
			if (last !== null && (Math.sign(last) === Math.sign(swing) || Math.abs(Math.abs(last) - Math.abs(swing)) > 0.5)) return false
			last = swing
			swings++
		}
		return swings >= 3
	}
	return (
		(distinct(xs).length >= 2 && distinct(xs).length <= 4 && teeth(ys, xs)) ||
		(distinct(ys).length >= 2 && distinct(ys).length <= 4 && teeth(xs, ys))
	)
}
export function roundedPath(body: string): boolean {
	const tokens = body.replace(/^["']|["']$/g, "").match(/[A-Za-z]|[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?/g) ?? []
	const segments: { a: Point; b: Point; line: boolean }[] = [],
		points: Point[] = []
	let at: Point = [0, 0],
		start: Point = [0, 0],
		cmd = "",
		i = 0
	let lastCubic: Point | null = null,
		lastQuad: Point | null = null
	while (i < tokens.length) {
		const token = tokens[i] ?? ""
		if (/^[a-z]$/i.test(token)) {
			cmd = token
			i++
			if (cmd.toLowerCase() === "z") {
				if (at[0] !== start[0] || at[1] !== start[1]) segments.push({ a: at, b: start, line: true })
				at = start
				cmd = ""
			}
			continue
		}
		const upper = cmd.toUpperCase(),
			arity =
				upper === "H" || upper === "V"
					? 1
					: upper === "C"
						? 6
						: upper === "A"
							? 7
							: upper === "S" || upper === "Q"
								? 4
								: ["M", "L", "T"].includes(upper)
									? 2
									: 0
		if (arity === 0 || i + arity > tokens.length) return false
		const args = tokens.slice(i, i + arity).map(Number)
		if (args.some((n) => !Number.isFinite(n))) return false
		i += arity
		const rel = cmd !== upper,
			base: Point = rel ? at : [0, 0]
		const end: Point =
			upper === "H"
				? [base[0] + (args[0] ?? 0), at[1]]
				: upper === "V"
					? [at[0], base[1] + (args[0] ?? 0)]
					: [base[0] + (args[arity - 2] ?? 0), base[1] + (args[arity - 1] ?? 0)]
		const point = (k: number): Point => [base[0] + (args[k] ?? 0), base[1] + (args[k + 1] ?? 0)]
		const reflect = (p: Point | null): Point => (p ? [2 * at[0] - p[0], 2 * at[1] - p[1]] : at)
		let nextCubic: Point | null = null,
			nextQuad: Point | null = null
		if (upper === "C" || upper === "S") {
			const c1 = upper === "C" ? point(0) : reflect(lastCubic),
				c2 = point(upper === "C" ? 2 : 0)
			points.push(...cubic(at, c1, c2, end))
			nextCubic = c2
		} else if (upper === "Q" || upper === "T") {
			const c: Point = upper === "Q" ? point(0) : reflect(lastQuad)
			points.push(...cubic(at, lerp(at, c, 2 / 3), lerp(end, c, 2 / 3), end))
			nextQuad = c
		} else if (upper === "A")
			points.push(...arc(at, args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, (args[3] ?? 0) !== 0, (args[4] ?? 0) !== 0, end))
		lastCubic = nextCubic
		lastQuad = nextQuad
		if (upper === "M") {
			start = end
			cmd = rel ? "l" : "L"
		} else segments.push({ a: at, b: end, line: ["L", "H", "V"].includes(upper) })
		points.push(end)
		at = end
	}
	const lines = segments.filter((s) => s.line)
	if (lines.length < 4) return false
	const xs = points.map((p) => p[0]),
		ys = points.map((p) => p[1]),
		minX = Math.min(...xs),
		maxX = Math.max(...xs),
		minY = Math.min(...ys),
		maxY = Math.max(...ys)
	const tol = Math.max(1, maxX - minX, maxY - minY) * 0.01,
		near = (a: number, b: number): boolean => Math.abs(a - b) <= tol
	const edges = (p: Point): number[] =>
		[near(p[1], minY) ? 0 : -1, near(p[0], maxX) ? 1 : -1, near(p[1], maxY) ? 2 : -1, near(p[0], minX) ? 3 : -1].filter((i) => i >= 0)
	const reached = new Set<number>()
	for (const l of lines) {
		const edge = edges(l.a).find((i) => edges(l.b).includes(i))
		if (edge === undefined) return false
		reached.add(edge)
	}
	if (reached.size !== 4) return false
	const first = segments.findIndex((s) => s.line)
	const run: Point[] = []
	for (let k = 1; k <= segments.length; k++) {
		const segment = segments[(first + k) % segments.length]
		if (!segment) continue
		const a = run[0],
			b = run[1]
		if (segment.line) {
			if (a && b && !edges(a).some((x) => edges(b).some((y) => x % 2 !== y % 2))) return false
			run.length = 0
		} else {
			run[0] = a ?? segment.a
			run[1] = segment.b
		}
	}
	return true
}
