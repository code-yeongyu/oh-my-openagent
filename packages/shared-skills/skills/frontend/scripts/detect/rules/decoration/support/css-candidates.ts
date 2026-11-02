import { ancestors, parentOf } from "../../../core/page"
import { cssBlocks } from "../../../core/source"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

function compound(e: ElementSnapshot, selector: string): boolean {
	const tag = /^[a-z][\w-]*|^\*/i.exec(selector)?.[0]
	if (tag && tag !== "*" && e.tag !== tag.toLowerCase()) return false
	let rest = selector.slice(tag?.length ?? 0)
	for (const m of rest.matchAll(/([.#])([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
		if (m[1] === "#" && e.attributes["id"] !== m[2]) return false
		if (m[1] === "." && !(e.attributes["class"] ?? "").split(/\s+/).includes(m[2] ?? "")) return false
		if (m[3] && (e.attributes[m[3]] === undefined || (m[4] !== undefined && e.attributes[m[3]] !== m[4]))) return false
	}
	rest = rest.replace(/([.#])[\w-]+|\[[^\]]+\]/g, "")
	return rest === ""
}

export function matchesSelector(s: PageSnapshot, e: ElementSnapshot, selector: string): boolean {
	const pieces = selector.trim().replace(/\s*>\s*/g, " > ").split(/\s+/)
	const last = pieces.pop()
	if (!last || !compound(e, last)) return false
	let current = e
	while (pieces.length > 0) {
		const part = pieces.pop()
		if (part === ">") {
			const parent = parentOf(s, current)
			const wanted = pieces.pop()
			if (!parent || !wanted || !compound(parent, wanted)) return false
			current = parent
		} else {
			const match = [...ancestors(s, current)].find(a => compound(a, part ?? ""))
			if (!match) return false
			current = match
		}
	}
	return true
}

export function cssCandidates(s: PageSnapshot): ReadonlyMap<string, Readonly<Record<string, string>>> {
	const merged = new Map<string, Record<string, string>>()
	for (const css of s.cssText) {
		let text = css
		for (const match of css.matchAll(/@media[^{]*prefers-reduced-motion\s*:\s*reduce\s*\)[^{]*\{/g)) {
			let end = (match.index ?? 0) + match[0].length
			let depth = 1
			const start = match.index ?? 0
			while (end < css.length && depth > 0) {
				if (css[end] === "{") depth++
				if (css[end] === "}") depth--
				end++
			}
			text = text.replace(css.slice(start, end), "")
		}
		for (const block of cssBlocks(text)) {
			for (const selector of block.selector.split(",").map(v => v.trim()).filter(v => v !== "" && !v.startsWith("@"))) {
				const declarations = merged.get(selector) ?? {}
				for (const entry of block.body.split(";")) {
					const colon = entry.indexOf(":")
					if (colon >= 0) declarations[entry.slice(0, colon).trim().toLowerCase()] = entry.slice(colon + 1).trim()
				}
				merged.set(selector, declarations)
			}
		}
	}
	return merged
}
