import type { PageRule } from "../../rule"
import type { ElementSnapshot } from "../../types"
import { childrenOf, effectiveBackground, parentOf, shortSnippet, styleOf } from "../../core/page"
import { parseColor, WHITE } from "../../core/color"
import { parseShadow } from "../../core/shadow"
import { length, showsOver, sides, visible } from "./support/appearance"
export const gptThinBorderWideShadow: PageRule = {
	meta: {
		id: "gpt-thin-border-wide-shadow",
		name: "Hairline border with wide shadow",
		category: "slop",
		severity: "advisory",
		engine: "page",
		description: "Comparable cards repeat a hairline edge and broad halo.",
		fixHint: "Choose one edge treatment across the row: border or elevation.",
	},
	check: ({ snapshot }) => {
		const pair = (e: ElementSnapshot): boolean => {
			if (!visible(snapshot, e)) return false
			const p = parentOf(snapshot, e),
				surface = p ? effectiveBackground(snapshot, p) : WHITE
			const halo = parseShadow(styleOf(e, "box-shadow")).some(
				(l) => !l.inset && l.color.a >= 0.12 && l.blur + Math.min(0, l.spread) >= 32 && showsOver(l.color, surface),
			)
			if (!halo) return false
			const fill = effectiveBackground(snapshot, e)
			return (
				sides.filter((side) => {
					const w = length(styleOf(e, "border-" + side + "-width")),
						c = parseColor(styleOf(e, "border-" + side + "-color"))
					return w > 0 && w <= 1.5 && c !== null && c.a >= 0.28 && showsOver(c, fill)
				}).length >= 2
			)
		}
		const matches = (a: ElementSnapshot, b: ElementSnapshot): boolean =>
			["width", "height"].every((k) => {
				const x = k === "width" ? a.rect.width : a.rect.height,
					y = k === "width" ? b.rect.width : b.rect.height
				return Math.max(x, y) > 0 && Math.abs(x - y) / Math.max(x, y) <= 0.25
			})
		return snapshot.elements.flatMap((e) => {
			if (!pair(e)) return []
			let cell = e
			for (let depth = 0; depth <= 2; depth++) {
				const p = parentOf(snapshot, cell)
				if (!p) break
				const siblings = childrenOf(snapshot, p),
					at = siblings.findIndex((s) => s.index === cell.index)
				let count = 1
				for (const sibling of siblings.slice(Math.max(0, at - 24), at + 25)) {
					if (sibling.index === cell.index || (depth > 0 && sibling.tag !== cell.tag)) continue
					let level: readonly ElementSnapshot[] = [sibling],
						budget = 32
					for (let i = 0; i < depth; i++) {
						level = level.flatMap((n) => childrenOf(snapshot, n)).slice(0, budget)
						budget -= level.length
					}
					count += level.filter((n) => matches(e, n) && pair(n)).length
				}
				if (count >= 3) return [{ element: e, message: "Hairline border and broad shadow repeated across a row", snippet: shortSnippet(e) }]
				cell = p
			}
			return []
		})
	},
}
