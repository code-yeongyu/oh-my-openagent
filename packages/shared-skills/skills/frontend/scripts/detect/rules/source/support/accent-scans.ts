import type { SourceContext, SourceHit } from "../../../rule"
import { roundedAway, scopeCorners } from "./corners"
import { cleanSelector, cssScopes, declarations, selectorHost, type CssScope } from "./css-scopes"
import { sourceHit, sourcePasses } from "./source-text"
import { sourceShadows } from "./source-shadow"
import { chromatic } from "./source-color"

export const safeSelector = (selector: string): boolean => /:(?:hover|focus|active|visited)|aria-(?:selected|current)|(?:^|[.\s_-])(?:selected|current|active|checked)(?:$|[.\s_:-])|(?:^|[\s>+~])(?:blockquote|nav|pre|code|a|input|span)(?:$|[\s.#:[>])/i.test(selector)

function pseudoEdge(scope: CssScope): string | null {
	const d = declarations(scope.body)
	if (!/^(?:absolute|fixed)$/.test(d.get("position") ?? "")) return null
	const inset = d.get("inset")?.split(/\s+/)
	const [t = "", r = t, b = t, l = r] = inset ?? []
	const top = d.get("top") ?? t
	const right = d.get("right") ?? d.get("inset-inline-end") ?? r
	const bottom = d.get("bottom") ?? b
	const left = d.get("left") ?? d.get("inset-inline-start") ?? l
	const zero = (value: string): boolean => /^0(?:px|rem|em|%)?$/.test(value)
	const width = Number.parseFloat(d.get("width") ?? d.get("inline-size") ?? "")
	const height = Number.parseFloat(d.get("height") ?? d.get("block-size") ?? "")
	const fullHeight = (zero(top) && zero(bottom)) || d.get("height") === "100%" || [top, bottom].every((v) => /^\d+(?:px)?$/.test(v) && Number.parseFloat(v) <= 20)
	if (width >= 3 && width <= 12 && fullHeight) return zero(left) ? "left" : zero(right) ? "right" : null
	const fullWidth = (zero(left) && zero(right)) || d.get("width") === "100%"
	if (height >= 3 && height <= 12 && fullWidth && !safeSelector(scope.selector) && !/(?:^|[ .>])(?:button|summary|tr|td|th|table|li)(?:$|[.#:\s])/.test(scope.selector)) return zero(top) ? "top" : zero(bottom) ? "bottom" : null
	return null
}

function resolveTokens(value: string, text: string): string {
	const tokens = new Map([...text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)].map((m) => [m[1] ?? "", m[2] ?? ""]))
	let result = value
	for (let depth = 0; depth < 8; depth++) {
		const next = result.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (whole: string, key: string, fallback: string | undefined) => tokens.get(key) ?? fallback ?? whole)
		if (next === result) break
		result = next
	}
	return result
}

export function accentScans(context: SourceContext): readonly SourceHit[] {
	const hits: SourceHit[] = []
	const seen = new Set<string>()
	for (const pass of sourcePasses(context).filter((p) => p.css)) {
		const scopes = cssScopes(pass.text, pass.sass)
		for (const scope of scopes) {
			const selector = selectorHost(scope)
			const d = declarations(scope.body)
			const pseudo = /::?(?:before|after)\b/.test(selector)
			if (pseudo) {
				const side = pseudoEdge(scope)
				const bg = resolveTokens(d.get("background-color") ?? d.get("background") ?? "", context.file.text)
				if (!side || !bg || !chromatic(bg) || /(?:^|[ >])(?:blockquote|pre|code)\b/.test(selector)) continue
				const host = cleanSelector(selector)
				const hostScope = scopes.find((s) => cleanSelector(selectorHost(s)) === host && !/::?(?:before|after)/.test(s.selector)) ?? scope
				if ((side === "left" || side === "right") && !roundedAway(scopeCorners(hostScope, scopes, host), side)) continue
				const key = `${pass.offset}:${selector.includes("&") ? scope.start : selector}`
				if (seen.has(key)) continue
				seen.add(key)
				hits.push(sourceHit(context.file.text, pass.offset + scope.start, `${scope.selector} pseudo-element stripe (${side})`, scope.selector))
				continue
			}
			if (safeSelector(selector) || Number.parseFloat(d.get("width") ?? "999") <= 40) continue
			const shadow = resolveTokens(d.get("box-shadow") ?? "", context.file.text)
			const status = /(?:^|[ .>])(?:tr|td|th)\b|(?:error|danger|warning|success|broken|new)\b/.test(selector)
			for (const layer of sourceShadows(shadow, status)) {
				const ax = Math.abs(layer.x)
				const ay = Math.abs(layer.y)
				if (!layer.inset || layer.blur !== 0 || layer.spread !== 0 || layer.color.a < 0.1 || Math.max(layer.color.r, layer.color.g, layer.color.b) - Math.min(layer.color.r, layer.color.g, layer.color.b) < 30) continue
				if (!((ax >= 3 && ax <= 12 && ay === 0) || (ay >= 3 && ay <= 12 && ax === 0))) continue
				const side = ay === 0 ? layer.x > 0 ? "left" : "right" : layer.y > 0 ? "top" : "bottom"
				if (!(status && ay === 0) && !roundedAway(scopeCorners(scope, scopes), side)) continue
				hits.push(sourceHit(context.file.text, pass.offset + scope.start, `${scope.selector} inset stripe (${side})`, scope.selector))
				break
			}
		}
	}
	return hits
}
