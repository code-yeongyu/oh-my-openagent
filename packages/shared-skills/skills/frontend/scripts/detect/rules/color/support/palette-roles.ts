import { parseColor, toHsl, type Rgba } from "../../../core/color"
import { ancestors, fontSizePx, isHeading, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { gradientStops, spread } from "./gradients"

export const tellHue = (c: Rgba): "cyan" | "purple" | null => {
	const { h, s } = toHsl(c)
	return h >= 260 && h <= 310 ? "purple" : h >= 170 && h <= 197 && s >= 0.4 ? "cyan" : null
}

export function paletteVisible(snapshot: PageSnapshot, el: ElementSnapshot): boolean {
	return el.rect.width > 0 && el.rect.height > 0 && [el, ...ancestors(snapshot, el)].every((node) =>
		styleOf(node, "display") !== "none" && !["hidden", "collapse"].includes(styleOf(node, "visibility")))
}

function roleKey(el: ElementSnapshot, fill: boolean): string {
	return fill ? `${el.tag}|${Math.round(el.rect.width)}x${Math.round(el.rect.height)}` : `${el.tag}|${fontSizePx(el)}|${styleOf(el, "font-weight")}`
}

export function categoryColor(snapshot: PageSnapshot, el: ElementSnapshot, fill: boolean): boolean {
	const hues: number[] = []
	for (const other of snapshot.elements) {
		if (!paletteVisible(snapshot, other) || roleKey(other, fill) !== roleKey(el, fill)) continue
		const color = fill
			? gradientStops(styleOf(other, "background-image")).find((s) => s.color.a > 0.1 && spread(s.color) > 50)?.color
			: parseColor(styleOf(other, "color"))
		if (color && spread(color) > 50 && (fill || color.a >= 0.5)) hues.push(toHsl(color).h)
	}
	const distinct: number[] = []
	for (const h of hues.sort((a, b) => a - b)) if (h - (distinct.at(-1) ?? -360) >= 5) distinct.push(h)
	if (distinct.length > 1 && (distinct[0] ?? 0) + 360 - (distinct.at(-1) ?? 0) < 5) distinct.pop()
	const outside = distinct.filter((h) => !(h >= 260 && h <= 310) && !(h >= 170 && h <= 197)).length
	return distinct.length >= 6 && outside * 2 >= distinct.length
}

export function brandColor(snapshot: PageSnapshot, ink: Rgba): boolean {
	return snapshot.elements.some((el) => {
		if (!paletteVisible(snapshot, el)) return false
		const local = [...ancestors(snapshot, el)].some((a) => a.tag === "main" || a.tag === "article")
		const name = [el.attributes["id"], el.attributes["class"], el.attributes["aria-label"], el.attributes["alt"]].join(" ").toLowerCase()
		const namedLogo = /(?:^|[\s_-])(logo|wordmark|logotype)(?:$|[\s_-])/.test(name) && !/(logos|gallery|grid|wall|list|strip|row|carousel|cloud|title|heading|section)/.test(name)
		if (isHeading(el) && !namedLogo) return false
		const logo = !local && namedLogo
		const bar = !local && (["nav", "header"].includes(el.tag) || ["navigation", "banner"].includes(el.attributes["role"] ?? "")) && el.rect.width >= snapshot.viewport.width * 0.5
		const band = el.rect.width >= snapshot.viewport.width * 0.9 && el.rect.width * el.rect.height >= snapshot.viewport.width * snapshot.viewport.height * 0.2
		if (!logo && !bar && !band) return false
		const colors = gradientStops(styleOf(el, "background-image")).length === 0 ? [parseColor(styleOf(el, "background-color"))] : []
		if (logo) {
			const text = el.ownText ? el : snapshot.elements.find((node) => node.ownText && [...ancestors(snapshot, node)].some((a) => a.index === el.index))
			if (text) colors.push(parseColor(styleOf(text, "color")))
		}
		return colors.some((c) => {
			if (!c || c.a < 0.9 || spread(c) <= 50) return false
			const delta = Math.abs(toHsl(c).h - toHsl(ink).h)
			return Math.min(delta, 360 - delta) <= 12
		})
	})
}
