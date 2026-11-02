import { luminance } from "../../../core/color"
import { isIgnored, isRendered, styleOf } from "../../../core/page"
import { parseShadow, type ShadowLayer } from "../../../core/shadow"
import type { PageHit } from "../../../rule"
import type { PageSnapshot } from "../../../types"
import { backdrop, colorDistance, effectiveOpacity, spread } from "./gradients"

function glow(layer: ShadowLayer, dark: boolean): boolean {
	return spread(layer.color) >= 30 && layer.blur > 4 && layer.blur * layer.color.a >= 3
		&& layer.blur / 2 + layer.spread > 0 && (dark || (layer.x === 0 && layer.y === 0))
}

export function glowForm(snapshot: PageSnapshot, hits: readonly PageHit[]): PageHit | null {
	const reported = hits.flatMap((hit) => {
		const element = hit.element
		return element ? ["box-shadow", "text-shadow"].flatMap((p) => parseShadow(styleOf(element, p)).map((layer) => ({ property: p, layer }))) : []
	})
	const unreported = (property: string, layer: ShadowLayer): boolean =>
		!reported.some((r) => r.property === property && colorDistance(r.layer.color, layer.color) < 1)
	for (const host of snapshot.elements) {
		if (!isRendered(snapshot, host) || effectiveOpacity(snapshot, host) <= 0.02 || isIgnored(snapshot, host, "dark-glow")) continue
		const surface = backdrop(snapshot, host)
		const dark = surface !== null && luminance(surface) < 0.1
		for (const pseudo of [host.before, host.after]) {
			if (!pseudo || ["none", "normal"].includes(pseudo.style["content"] ?? "none") || pseudo.style["display"] === "none" || Number(pseudo.style["opacity"] ?? 1) <= 0.02) continue
			for (const property of ["box-shadow", "text-shadow"]) {
				if (parseShadow(pseudo.style[property] ?? "").some((layer) => glow(layer, dark) && unreported(property, layer))) {
					return { element: null, message: "A pseudo-element paints a colored shadow glow", snippet: "Pseudo-element glow" }
				}
			}
		}
	}
	for (const css of snapshot.cssText) for (const match of css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g)) {
		let depth = 1
		const start = (match.index ?? 0) + match[0].length
		let end = start
		for (; end < css.length && depth > 0; end++) {
			if (css[end] === "{") depth++
			if (css[end] === "}") depth--
		}
		const carriers = snapshot.elements.filter((el) => styleOf(el, "animation-name").split(",").map((n) => n.trim()).includes(match[1] ?? "")
			&& isRendered(snapshot, el) && effectiveOpacity(snapshot, el) > 0.02 && !isIgnored(snapshot, el, "dark-glow"))
		if (carriers.length === 0) continue
		for (const declaration of css.slice(start, end).matchAll(/(?<![-\w])(box-shadow|text-shadow)\s*:\s*([^;{}]+)/g)) {
			const property = declaration[1] ?? ""
			const body = snapshot.elements.find((el) => el.tag === "body")
			const root = body ? backdrop(snapshot, body) : null
			const dark = root !== null && luminance(root) < 0.1
			if (parseShadow(declaration[2] ?? "").some((layer) => glow(layer, dark) && unreported(property, layer)
				&& !snapshot.elements.some((el) => parseShadow(styleOf(el, property)).some((own) => own.blur > 4 && colorDistance(own.color, layer.color) < 1)))) {
				return { element: null, message: "A running animation declares a colored shadow glow", snippet: "Keyframe glow" }
			}
		}
	}
	return null
}
