import { childrenOf, px, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot, Rect } from "../../../types"
import { visibleText } from "./text-context"

export function phrasingNodes(s: PageSnapshot, e: ElementSnapshot): readonly ElementSnapshot[] {
	const nodes: ElementSnapshot[] = []
	const walk = (n: ElementSnapshot): void => {
		if (visibleText(s, n) === false) return
		nodes.push(n)
		for (const c of childrenOf(s, n)) {
			if (["inline", "contents"].includes(styleOf(c, "display")) || ["br", "wbr"].includes(c.tag)) walk(c)
		}
	}
	walk(e)
	return nodes
}

export function mergedLines(nodes: readonly ElementSnapshot[]): readonly Rect[] {
	const lines: Rect[] = []
	for (const r of nodes.flatMap(n => n.lineRects).sort((a, b) => a.y - b.y || a.x - b.x)) {
		const match = lines.find(l => Math.abs(l.y - r.y) <= Math.max(2, Math.min(l.height, r.height) * 0.5))
		if (match) {
			const i = lines.indexOf(match)
			const x = Math.min(match.x, r.x)
			const y = Math.min(match.y, r.y)
			lines[i] = { x, y, width: Math.max(match.x + match.width, r.x + r.width) - x, height: Math.max(match.y + match.height, r.y + r.height) - y }
		} else lines.push(r)
	}
	return lines
}

export function renderedCharacters(nodes: readonly ElementSnapshot[]): number {
	return nodes.reduce((n, e) => n + [...e.ownText.normalize("NFC")].filter(c =>
		/[\p{M}\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(c) === false).length, 0)
}

export function shownLines(s: PageSnapshot, e: ElementSnapshot, lineHeight: number): number {
	const lines = mergedLines(phrasingNodes(s, e))
	const top = lines[0]?.y
	if (top === undefined || lineHeight <= 0) return 0
	const bottom = Math.max(...lines.map(r => r.y + r.height))
	return Math.max(1, Math.round((bottom - top - (px(styleOf(e, "font-size")) ?? 16)) / lineHeight) + 1)
}
