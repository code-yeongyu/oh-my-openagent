import { blend, parseColor, WHITE, type Rgba } from "../../../core/color"
import { ancestors, fontSizePx, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { effectiveOpacity, gradientStops } from "./gradients"
import { gradientSamples } from "./gradient-samples"
import { contains, pseudoCovers, siblingGrounds, textPainted, textRect } from "./painted-text"
import { textOpacity } from "./animation-opacity"

export const clipsText = (el: ElementSnapshot): boolean =>
	[styleOf(el, "background-clip"), styleOf(el, "-webkit-background-clip")].some((v) => v.split(",").some((s) => s.trim() === "text"))

export function textInk(snapshot: PageSnapshot, el: ElementSnapshot): Rgba | null {
	if (!textPainted(snapshot, el) || !/[\p{L}\p{N}]/u.test(el.ownText)) return null
	if (fontSizePx(el) <= 0 || [el, ...ancestors(snapshot, el)].some((node) => ["video", "audio", "canvas", "iframe"].includes(node.tag))) return null
	if (["script", "style", "title", "option", "noscript", "template"].includes(el.tag)) return null
	const fill = styleOf(el, "-webkit-text-fill-color")
	const color = parseColor(fill || styleOf(el, "color"))
	if (!color || color.a <= 0.02) return null
	return { ...color, a: color.a * textOpacity(snapshot, el) }
}

export function textBackgrounds(snapshot: PageSnapshot, el: ElementSnapshot): readonly Rgba[] {
	const layers: Rgba[] = []
	const rect = textRect(el)
	const nodes = [el, ...ancestors(snapshot, el)].flatMap((node) => [node, ...siblingGrounds(snapshot, node, rect)])
	for (const node of nodes) {
		if (["img", "video", "canvas"].includes(node.tag)) return []
		const paired = node.before && node.after && contains(node.rect, rect)
			&& node.before.style["background-color"] === node.after.style["background-color"]
			&& node.before.style["background-image"] === node.after.style["background-image"]
			&& [node.before, node.after].every((p) => Number.parseFloat(p.style["opacity"] ?? "1") >= 0.9)
		for (const pseudo of [node.after, node.before]) {
			if (!pseudo || (!paired && !pseudoCovers(pseudo.style, node, rect))) continue
			const hostFill = parseColor(styleOf(node, "background-color"))
			if (Number.parseFloat(pseudo.style["z-index"] ?? "") < 0 && styleOf(node, "z-index") === "auto" && (hostFill?.a ?? 0) >= 1) continue
			const fill = parseColor(pseudo.style["background-color"] ?? "")
			const stops = gradientStops(pseudo.style["background-image"] ?? "")
			if (stops.length > 0 && fill && fill.a >= 0.9) {
				return stops.map((s) => layers.reduceRight((under, top) => blend(top, under), blend(s.color, fill)))
			}
			if (fill && fill.a >= 0.9) return [layers.reduceRight((under, top) => blend(top, under), fill)]
		}
		const image = styleOf(node, "background-image")
		if (image.includes("url(")) return []
		const tile = styleOf(node, "background-size").split(/\s+/)
		const tileWidth = Number.parseFloat(tile[0] ?? "")
		const tileHeight = Number.parseFloat(tile[1] ?? tile[0] ?? "")
		const stops = gradientStops(image)
		const radius = /([\d.]+)px/.exec(stops[0]?.raw ?? "")
		const sparseDots = image.startsWith("radial-gradient(") && radius !== null && tileWidth > 0 && tileHeight > 0 && Math.PI * Number(radius[1]) ** 2 / (tileWidth * tileHeight) < 0.5 && (stops[0]?.color.a ?? 0) > 0
		const parkedImage = tile.some((v) => /^0(?:px|%)?$/.test(v))
		if (image.includes("gradient") && !clipsText(node) && !sparseDots && !parkedImage) {
			const ground = solidGround(snapshot, node)
			const samples = gradientSamples(node, rect)
			if (samples?.every((color) => color.a < 0.005)) continue
			return (samples ?? stops.map((s) => s.color)).map((color) => layers.reduceRight((under, top) => blend(top, under), blend(color, ground)))
		}
		const rawFill = styleOf(node, "background-color")
		const fill = parseColor(rawFill)
		if (rawFill !== "" && !fill) return []
		if (fill && fill.a > 0) {
			const a = fill.a * (nodes.includes(node) && ![el, ...ancestors(snapshot, el)].includes(node) ? effectiveOpacity(snapshot, node) : 1)
			layers.push({ ...fill, a })
			if (a >= 1) break
		}
	}
	return [layers.reduceRight((under, top) => blend(top, under), WHITE)]
}

export function solidGround(snapshot: PageSnapshot, el: ElementSnapshot): Rgba {
	const layers: Rgba[] = []
	for (const node of [el, ...ancestors(snapshot, el)]) {
		const c = parseColor(styleOf(node, "background-color"))
		if (c) {
			layers.push(c)
			if (c.a >= 1) break
		}
	}
	return layers.reduceRight((under, top) => blend(top, under), WHITE)
}
