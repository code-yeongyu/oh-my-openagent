import type { PageRule } from "../../rule"
import type { ElementSnapshot } from "../../types"
import { ancestors, childrenOf, parentOf, shortSnippet, styleOf } from "../../core/page"
import { colorsIn } from "../../core/color"
import { splitTop } from "./support/appearance"
import { pendingRaster } from "./support/raster-state"
export const buriedRaster: PageRule = {
	meta: {
		id: "buried-raster",
		name: "Raster buried under a wash or opacity",
		category: "quality",
		severity: "warning",
		engine: "page",
		description: "A raster image is almost invisible under a wash or low opacity.",
		fixHint: "Let the photo or material show through, or remove the unused raster.",
	},
	check: ({ snapshot }) => {
		const raster = (e: ElementSnapshot): boolean =>
			["img", "picture", "video", "canvas"].includes(e.tag) || /url\(/i.test(styleOf(e, "background-image"))
		return snapshot.elements.flatMap((e) => {
			const bg = styleOf(e, "background-image"),
				src = e.attributes["src"] ?? ""
			if (e.rect.width <= 0 || e.rect.height <= 0 || styleOf(e, "display") === "none" || !raster(e) || pendingRaster(snapshot, e)) return []
			const urls = [...bg.matchAll(/url\(["']?([^)]*?)["']?\)/gi)].map((m) => m[1] ?? "")
			const svg = (s: string): boolean => /^data:image\/svg\+xml/i.test(s) || /\.svg(?:[?#]|$)/i.test(s)
			if (e.tag === "img" ? svg(src) : urls.length > 0 && urls.every(svg)) return []
			const opacity = Number(styleOf(e, "opacity"))
			const faint = Number.isFinite(opacity) && opacity >= 0 && opacity < 0.15
			const layers = splitTop(bg),
				imageAt = layers.findIndex((l) => /url\(/i.test(l))
			const washed =
				imageAt >= 0 &&
				layers.slice(0, imageAt).some((l) => {
					const stops = colorsIn(l)
					return /gradient\(/i.test(l) && stops.length > 0 && stops.every((c) => c.a >= 0.9)
				})
			if (!faint && !washed) return []
			if (faint) {
				if (
					(e.rect.width <= 48 && e.rect.height <= 48) ||
					[...styleOf(e, "filter").matchAll(/blur\(([\d.]+)px\)/g)].some((m) => Number(m[1]) >= 4)
				)
					return []
				const area = e.rect.width * e.rect.height,
					p = parentOf(snapshot, e)
				const cover = (n: ElementSnapshot): boolean => {
					if (n.index === e.index || !raster(n) || Number(styleOf(n, "opacity")) < 0.15 || styleOf(n, "display") === "none") return false
					const w = Math.max(0, Math.min(e.rect.x + e.rect.width, n.rect.x + n.rect.width) - Math.max(e.rect.x, n.rect.x))
					const h = Math.max(0, Math.min(e.rect.y + e.rect.height, n.rect.y + n.rect.height) - Math.max(e.rect.y, n.rect.y))
					return w * h >= area * 0.5
				}
				if (
					(p && childrenOf(snapshot, p).some(cover)) ||
					[...ancestors(snapshot, e)]
						.slice(0, 2)
						.filter((a) => a.tag !== "body")
						.some(cover)
				)
					return []
			}
			const blend = [styleOf(e, "background-blend-mode"), styleOf(e, "mix-blend-mode")].flatMap(v => v.split(","))
			if (blend.some(v => v.trim() !== "" && v.trim() !== "normal")) return []
			return [
				{
					element: e,
					message: faint ? "Raster at opacity " + opacity : "Raster covered by a near-opaque gradient",
					snippet: shortSnippet(e),
				},
			]
		})
	},
}
