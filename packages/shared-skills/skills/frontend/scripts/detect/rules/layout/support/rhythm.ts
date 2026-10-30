import { childrenOf, descendants, fontSizePx, isHeading, parentOf, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { cardLike, fillDiffers } from "./cards"
import { alpha, borders, bottom, chain, length, outOfFlow, painted, right, textLines } from "./geometry"

export const paintsEdge = (el: ElementSnapshot, side: string): boolean =>
	alpha(el, "background-color") > 0.05 || length(el, `border-${side}-width`) > 0 ||
	!["", "none"].includes(styleOf(el, "box-shadow")) ||
	!styleOf(el, "background-clip").includes("text") && !styleOf(el, "-webkit-background-clip").includes("text") &&
	!["", "none"].includes(styleOf(el, "background-image")) &&
	(styleOf(el, "background-size") === "cover" || styleOf(el, "background-image").includes("gradient(") &&
		["auto", "auto auto", "100% 100%"].includes(styleOf(el, "background-size")))

const separates = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	borders(el).some(Boolean) || fillDiffers(s, el) || !["", "none"].includes(styleOf(el, "box-shadow"))
const spacer = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	el.text === "" && !separates(s, el) &&
	!(alpha(el, "background-color") > 0.05 && chain(s, el).slice(1).some((n) =>
		!["", "none"].includes(styleOf(n, "background-image")) && paintsEdge(n, "top"))) &&
	![el, ...descendants(s, el)].some((n) =>
		/^(img|video|canvas|iframe|svg|input|button)$/.test(n.tag) || n !== el && separates(s, n))

const flow = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	painted(s, el) && !outOfFlow(el) && styleOf(el, "position") !== "sticky" &&
	Number.parseFloat(styleOf(el, "opacity")) > 0.05 && !["inline", "none"].includes(styleOf(el, "display"))

function flowBoxes(s: PageSnapshot, el: ElementSnapshot, heading: ElementSnapshot): readonly ElementSnapshot[] {
	if (styleOf(el, "display") === "contents") return childrenOf(s, el).flatMap((c) => flowBoxes(s, c, heading))
	if (!flow(s, el) || spacer(s, el)) return []
	if (Math.min(right(el.rect), right(heading.rect)) - Math.max(el.rect.x, heading.rect.x) < 8) return []
	return [el]
}

function repeats(s: PageSnapshot, row: ElementSnapshot, heading: ElementSnapshot): boolean {
	const p = parentOf(s, row)
	if (!p) return false
	const kids = childrenOf(s, p)
	const i = kids.indexOf(row)
	const laysOut = (n: ElementSnapshot): boolean =>
		styleOf(n, "display") !== "none" && !outOfFlow(n) && n.rect.width >= 1 && n.rect.height >= 1 && !spacer(s, n)
	const neighbours = [kids.slice(0, i).reverse().find(laysOut), kids.slice(i + 1).find(laysOut)]
	const path = (n: ElementSnapshot, stop: ElementSnapshot): readonly string[] => {
		const steps: string[] = []
		let current = n
		while (current !== stop) {
			const parent = parentOf(s, current)
			if (!parent) return []
			steps.unshift(`${current.tag}:${childrenOf(s, parent).indexOf(current)}`)
			current = parent
		}
		return steps
	}
	const shape = (root: ElementSnapshot): string[] => {
		const tags: string[] = []
		let budget = 24
		const walk = (node: ElementSnapshot, depth: number): void => {
			tags.push(node.tag)
			if (depth === 0) return
			for (const child of childrenOf(s, node).filter((n) => styleOf(n, "display") !== "none" && !outOfFlow(n) && n.rect.width >= 1 && n.rect.height >= 1)) {
				if (budget-- <= 0) return
				walk(child, depth - 1)
			}
		}
		walk(root, 3)
		return tags
	}
	const ownPath = path(heading, row).join("/")
	const ownShape = shape(row)
	return neighbours.some((n) => {
		if (!n || n.tag !== row.tag || ![...descendants(s, n)].some((h) => h.tag === heading.tag && path(h, n).join("/") === ownPath)) return false
		const other = shape(n)
		const total = ownShape.length + other.length
		let shared = 0
		for (const tag of ownShape) {
			const at = other.indexOf(tag)
			if (at >= 0) { shared++; other.splice(at, 1) }
		}
		return shared * 2 / total >= 0.7
	})
}

export function neighbour(s: PageSnapshot, heading: ElementSnapshot, before: boolean, start = heading): ElementSnapshot | null {
	let cursor = start
	for (let depth = 0; depth < 20; depth++) {
		const parent = parentOf(s, cursor)
		if (!parent) return null
		const siblings = childrenOf(s, parent)
		if (!before && cursor !== heading && repeats(s, cursor, heading)) return null
		const i = siblings.indexOf(cursor)
		const choices = (before ? siblings.slice(0, i) : siblings.slice(i + 1))
			.flatMap((n) => flowBoxes(s, n, heading))
			.filter((n) => before ? bottom(n.rect) <= start.rect.y + 2 : n.rect.y >= bottom(heading.rect) - 2)
			.sort((a, b) => before ? bottom(b.rect) - bottom(a.rect) : a.rect.y - b.rect.y)
		const found = choices[0]
		if (found) return found
		if (parent.tag === "body" || separates(s, parent) || !before && (parent.tag === "main" || parent.attributes["role"] === "main")) return null
		cursor = parent
	}
	return null
}

export function headingCluster(s: PageSnapshot, heading: ElementSnapshot, below: number): ElementSnapshot {
	let top = heading
	for (let count = 0; count < 3; count++) {
		const previous = neighbour(s, heading, true, top)
		if (!previous || isHeading(previous) || previous.text.length === 0 || previous.text.length > 80 || previous.rect.height > 60) break
		const gap = top.rect.y - bottom(previous.rect)
		const words = [previous, ...descendants(s, previous)].filter((n) => n.ownText !== "")
		const word = words[0] ?? previous
		const p = parentOf(s, previous)
		const opens = p !== null && childrenOf(s, p).filter((n) => styleOf(n, "display") !== "none" && n.rect.width >= 1 && n.rect.height >= 1)[0] === previous
		const lines = words.flatMap((n) => textLines(s, n))
		const label = fontSizePx(word) <= fontSizePx(heading) && (fontSizePx(word) <= 14 || styleOf(word, "text-transform") === "uppercase" ||
			length(word, "letter-spacing") >= fontSizePx(word) * 0.05 || opens &&
			(styleOf(word, "font-style") === "italic" || Number.parseFloat(styleOf(word, "font-weight")) < 400 ||
				styleOf(word, "color") !== styleOf(heading, "color")))
		const subtitle = opens && gap <= 2 && fontSizePx(word) <= fontSizePx(heading) && lines.length <= 1
		if (gap < 0 || gap >= 28 && !(opens && gap < below && gap <= 64) || !(label || subtitle) || lines.length > 1) break
		top = previous
	}
	return top
}

export function rhythmExempt(s: PageSnapshot, el: ElementSnapshot): boolean {
	if (!flow(s, el) || el.text.length < 3 || !["h2", "h3", "h4"].includes(el.tag) || paintsEdge(el, "top")) return true
	return chain(s, el).some((a) => ["blockquote", "q", "nav", "footer"].includes(a.tag) ||
		a !== el && cardLike(s, a) && a.rect.height < 200)
}

export function closesInProse(s: PageSnapshot, el: ElementSnapshot, heading: ElementSnapshot, textSize: number): boolean {
	const blocks = [el, ...descendants(s, el)].filter((n) => ["p", "li", "dd", "div"].includes(n.tag) && n.ownText !== "" && flow(s, n))
	const last = blocks.sort((a, b) => bottom(b.rect) - bottom(a.rect))[0]
	return last !== undefined && last.text.length >= 80 && textLines(s, last).length >= 2 &&
		last.rect.width >= heading.rect.width * 0.5 && fontSizePx(last) < fontSizePx(heading) && fontSizePx(last) <= textSize * 1.25
}

export function separatesBelow(s: PageSnapshot, el: ElementSnapshot): boolean {
	if (el.tag === "hr" || el.rect.height <= 4) return true
	let node: ElementSnapshot | undefined = el
	let framed = false
	for (let depth = 0; depth < 8 && node; depth++) {
		const current = node
		framed ||= ["top", "left", "right"].some((side) => length(current, `border-${side}-width`) > 0)
		if (!framed && length(node, "border-bottom-width") > 0 && node.rect.width >= el.rect.width * 0.9 ||
			/^(img|picture|video|canvas|svg|iframe)$/.test(node.tag) && node.rect.width >= el.rect.width * 0.5 || isHeading(node)) return true
		node = [...childrenOf(s, node)].reverse().find((n) => styleOf(n, "display") !== "none" &&
			n.rect.width >= 1 && n.rect.height >= 1 && bottom(n.rect) >= bottom(el.rect) - 2)
	}
	return false
}

export function contentBottom(s: PageSnapshot, el: ElementSnapshot): number {
	let node = el
	for (let depth = 0; depth < 8; depth++) {
		if (paintsEdge(node, "bottom") || /^(img|picture|video|canvas|svg|iframe)$/.test(node.tag)) return Math.min(bottom(node.rect), bottom(el.rect))
		const lowest = childrenOf(s, node).filter((n) => flow(s, n) && !spacer(s, n)).sort((a, b) => bottom(b.rect) - bottom(a.rect))[0]
		if (!lowest) return Math.min(bottom(el.rect), bottom(node.rect) - Math.max(0, length(node, "padding-bottom")))
		node = lowest
	}
	return Math.min(bottom(el.rect), bottom(node.rect))
}
