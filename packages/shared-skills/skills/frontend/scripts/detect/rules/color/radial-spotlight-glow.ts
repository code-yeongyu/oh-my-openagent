import { blend, contrastRatio } from "../../core/color"
import { isRendered, shortSnippet, styleOf, textElements } from "../../core/page"
import type { PageRule } from "../../rule"
import { backdrop, effectiveOpacity, gradientStops, splitLayers, spread } from "./support/gradients"

export const radialSpotlightGlow: PageRule = {
	meta: {
		id: "radial-spotlight-glow", name: "Decorative radial spotlight glow", category: "slop", severity: "warning", engine: "page",
		description: "A translucent radial accent floats behind a section's copy.",
		fixHint: "Remove the floating wash or use a deliberate material surface.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		if (!isRendered(snapshot, el) || el.rect.width < 240 || el.rect.height < 160) return []
		const layers = splitLayers(styleOf(el, "background-image"))
		const index = layers.findIndex((layer) => layer.startsWith("radial-gradient("))
		if (index < 0) return []
		const stops = gradientStops(layers[index] ?? "")
		const last = stops.at(-1)
		const colors = stops.filter((s) => s.color.a > 0.05)
		if (!last || last.color.a > 0.05 || colors.length === 0 || colors.length > 2 || colors.some((s) => s.color.a >= 0.45)) return []
		const surface = backdrop(snapshot, el, layers.slice(index + 1).join(", "))
		const prominent = colors.some((s) => {
			const a = s.color.a * effectiveOpacity(snapshot, el)
			return spread(s.color) > 24 && a >= 0.14 && (surface === null || contrastRatio(blend({ ...s.color, a }, surface), surface) >= 1.3)
		})
		if (!prominent) return []
		const behindText = textElements(snapshot).some((text) => {
			const r = text.rect
			return r.x < el.rect.x + el.rect.width && r.x + r.width > el.rect.x && r.y < el.rect.y + el.rect.height && r.y + r.height > el.rect.y
		})
		return behindText ? [{ element: el, message: "A radial spotlight glows behind text", snippet: shortSnippet(el) }] : []
	}),
}
