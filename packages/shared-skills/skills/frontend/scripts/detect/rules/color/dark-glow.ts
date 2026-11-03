import { luminance, toHsl } from "../../core/color"
import { isRendered, shortSnippet, styleOf } from "../../core/page"
import { parseShadow } from "../../core/shadow"
import type { PageRule } from "../../rule"
import { backdrop, colorDistance, opacity, spread } from "./support/gradients"
import { glowForm } from "./support/glow-forms"
import { textBackgrounds } from "./support/text-colors"

export const darkGlow: PageRule = {
	meta: {
		id: "dark-glow", name: "Glowing shadow accents", category: "slop", severity: "warning", engine: "page",
		description: "A colored blurred shadow reads as a decorative glow.",
		fixHint: "Use a neutral elevation shadow or remove the halo.",
	},
	check: ({ snapshot }) => {
		const hits = snapshot.elements.flatMap((el) => {
			if (!isRendered(snapshot, el)) return []
			const parent = el.parent === null ? el : snapshot.elements[el.parent] ?? el
			const grounds = textBackgrounds(snapshot, { ...el, lineRects: [el.rect], style: { ...el.style, "background-color": "transparent", "background-image": "none" } })
			const surface = grounds[0] ?? backdrop(snapshot, parent)
			const dark = surface !== null && luminance(surface) < 0.1
			return ["box-shadow", "text-shadow"].flatMap((property) => {
				const value = styleOf(el, property)
				if (property === "text-shadow" && parent !== el && value === styleOf(parent, property)) return []
				const layers = parseShadow(value)
				const lift = surface === null ? null : layers.reduce((sum, layer) => {
					if (spread(layer.color) <= 30 || layer.blur * layer.color.a * opacity(el) < 1.5) return sum
					const hueDelta = Math.abs(toHsl(layer.color).h - toHsl(surface).h)
					const shade = (layer.x !== 0 || layer.y !== 0) && toHsl(layer.color).l < 0.25 && luminance(layer.color) < luminance(surface) && spread(surface) > 30 && Math.min(hueDelta, 360 - hueDelta) <= 50
					return sum + (shade ? 0 : 0.5 * layer.color.a * opacity(el) * colorDistance(layer.color, surface))
				}, 0)
				const hit = layers.find((layer) => {
					const extent = layer.blur / 2 + layer.spread
					const area = el.rect.width * el.rect.height
					const lit = (el.rect.width + 2 * extent) * (el.rect.height + 2 * extent) - area
					return !layer.inset && spread(layer.color) > 30 && layer.blur > 4 && extent > 0 && layer.blur * layer.color.a * opacity(el) >= 3 && lit <= area * 2 && (lift === null || lift >= 20) && ((layer.x === 0 && layer.y === 0) || dark)
				})
				return hit ? [{ element: el, message: `${property} creates a colored glow`, snippet: shortSnippet(el) }] : []
			})
		})
		const page = glowForm(snapshot, hits)
		return page ? [...hits, page] : hits
	},
}
