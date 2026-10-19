export type RuleId = "edge-stripe" | "pseudo-bar" | "inset-shadow-stripe" | "gradient-stripe"

export type Finding = {
	readonly file: string
	readonly line: number
	readonly column: number
	readonly rule: RuleId
	readonly excerpt: string
}

export const RULE_MESSAGES: Readonly<Record<RuleId, string>> = {
	"edge-stripe": "coloured one-side border on a rounded surface; the corners bend the stripe",
	"pseudo-bar": "coloured ::before/::after bar on a rounded surface",
	"inset-shadow-stripe": "inset box-shadow stripe on a rounded surface",
	"gradient-stripe": "hard-stop gradient band along one edge of a rounded surface",
}

export const FIX_HINT =
	"drop the stripe: separate with a tonal surface (one ink at a low alpha), an eyebrow or heading, a leading glyph, or spacing"

export function lineLocator(text: string): (offset: number) => { line: number; column: number } {
	const starts = [0]
	for (let i = 0; i < text.length; i += 1) if (text.charAt(i) === "\n") starts.push(i + 1)
	return (offset) => {
		let lo = 0
		let hi = starts.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1
			if ((starts[mid] ?? 0) <= offset) lo = mid
			else hi = mid - 1
		}
		return { line: lo + 1, column: offset - (starts[lo] ?? 0) + 1 }
	}
}
