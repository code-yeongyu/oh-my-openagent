import { luminance } from "../../../core/color"
import { cssScopes, declarations } from "./css-scopes"
import { authoredColor, authoredColors } from "./source-color"

export function resolveValues(text: string): string {
	const tokens = new Map([...text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)].map((m) => [m[1] ?? "", m[2] ?? ""]))
	let out = text
	for (let i = 0; i < 8; i++) {
		const next = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (whole: string, name: string, fallback: string | undefined) => tokens.get(name) ?? fallback ?? whole)
		if (out === next) break
		out = next
	}
	return out
}

export function darkBackground(text: string): boolean {
	const resolved = resolveValues(text)
	if (/\bbg-(?:gray|slate|zinc|neutral|stone)-(?:9\d{2}|800)\b/.test(resolved)) return true
	const dark = (value: string): boolean => {
		const color = authoredColor(value.trim())
		return color !== null && color.a > 0.5 && luminance(color) < 0.1
	}
	for (const m of resolved.matchAll(/(?<![-\w])background(?:-color)?\s*:\s*([^;{}]+)/gi)) {
		const value = (m[1] ?? "").trim()
		if (/^(?:#(?:[01][0-9a-f]{5}|2[0-3][0-9a-f]{4}|[01][0-9a-f]{2})\b|rgb\(\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\))/i.test(value) && dark(value)) return true
	}
	const roots = [
		...[...resolved.matchAll(/(?:^|[}\s,;>])(?:body|html|:root)\s*(?:,[^{]*)?\{([^}]*)\}/gi)].map((m) => m[1] ?? ""),
		...[...resolved.matchAll(/<body[^>]*\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? ""),
	]
	return roots.some((scope) => [...scope.matchAll(/(?<![-\w])background(?:-color)?\s*:\s*([^;{}]+)/gi)].some((m) => dark(m[1] ?? "")))
}

export function haloOffsets(text: string): readonly number[] {
	if (!darkBackground(text)) return []
	const resolved = resolveValues(text)
	const offsets: number[] = []
	for (const m of resolved.matchAll(/(?<![-\w])background(?:-image)?\s*:\s*([^;{}]+)/gi)) {
		const value = m[1] ?? ""
		if (/url\s*\(/i.test(value)) continue
		for (const g of value.matchAll(/(?<!repeating-)radial-gradient\(/gi)) {
			let end = (g.index ?? 0) + g[0].length
			let depth = 1
			for (; end < value.length && depth > 0; end++) {
				if (value[end] === "(") depth++
				else if (value[end] === ")") depth--
			}
			const gradient = value.slice(g.index, end)
			if ([...gradient.matchAll(/(-?[\d.]+)px\b/g)].some((p) => Math.abs(Number(p[1])) <= 24)) continue
			const colors = authoredColors(gradient)
			const first = colors[0]
			const last = /\btransparent\s*(?:[\d.%\s]*)\)$/.test(gradient) ? { a: 0 } : colors.at(-1)
			if (!first || !last || first.a < 0.7 || last.a > 0.05 || Math.max(first.r, first.g, first.b) - Math.min(first.r, first.g, first.b) < 24) continue
			offsets.push(m.index ?? 0)
		}
	}
	return offsets
}

export function marqueeSelectors(text: string): readonly string[] {
	const names: string[] = []
	for (const m of text.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g)) {
		let depth = 1
		let end = (m.index ?? 0) + m[0].length
		for (; end < text.length && depth > 0; end++) {
			if (text[end] === "{") depth++
			else if (text[end] === "}") depth--
		}
		const body = text.slice((m.index ?? 0) + m[0].length, end)
		if (/\btranslate(?:X)?\([^)]*(?:-?100|-?50)%/i.test(body)) names.push(m[1] ?? "")
	}
	const found = new Set<string>()
	if (/<marquee\b/i.test(text)) found.add("marquee")
	for (const scope of cssScopes(text)) {
		const d = declarations(scope.body)
		const animation = d.get("animation") ?? ""
		if (!/\binfinite\b/.test(animation + " " + (d.get("animation-iteration-count") ?? ""))) continue
		for (const name of names) if ((animation + " " + (d.get("animation-name") ?? "")).split(/[,\s]+/).includes(name)) found.add(`${scope.selector} ${name}`)
	}
	return [...found]
}
