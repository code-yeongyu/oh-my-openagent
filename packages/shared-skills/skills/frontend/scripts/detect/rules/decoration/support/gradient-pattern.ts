import { parseColor } from "../../../core/color"
import { splitTop } from "./appearance"
const position = (value: string): number | null => {
	const token = value
		.replace(/\s/g, "")
		.replace(/^(?:calc\()+/, "")
		.replace(/\)+$/, "")
	const match = /^([-+]?[\d.]+)(%|deg|grad|turn|px)?$/.exec(token)
	if (!match) return null
	const n = Number(match[1])
	if (n === 0) return 0
	return match[2] === "%" ? n / 100 : match[2] === "deg" ? n / 360 : match[2] === "grad" ? n / 400 : match[2] === "turn" ? n : null
}
export function repeats(value: string): boolean {
	for (const layer of splitTop(value)) {
		const m = /^repeating-(linear|radial)-gradient\(([\s\S]*)\)$/i.exec(layer)
		if (!m) continue
		const stops = splitTop(m[2] ?? ""),
			first = splitTop(stops[0] ?? "", /\s/),
			token = first[0] ?? ""
		if (token.includes("var(")) return true
		const start =
			parseColor(token) !== null ||
			(/^(?:transparent|currentcolor|[a-z]+)$/i.test(token) && !/^(?:circle|ellipse|to|at|in|closest|farthest)/i.test(token))
				? 0
				: 1
		if (stops.length < start + 2) return true
		if (m[1]?.toLowerCase() === "radial" && start === 1) {
			const prelude = (stops[0] ?? "").split(/\bat\b|\bin\b/)[0] ?? ""
			if (/closest-|farthest-side|[0-9]/.test(prelude)) return true
		}
		const a = splitTop(stops[start] ?? "", /\s/),
			b = splitTop(stops.at(-1) ?? "", /\s/)
		if (b.length === 1 && b[0]?.includes("var(")) return true
		const zero = a[1] === undefined || position(a[1]) === 0,
			full = b.length === 1 || position(b.at(-1) ?? "") === 1
		if (!(zero && full)) return true
	}
	return false
}
