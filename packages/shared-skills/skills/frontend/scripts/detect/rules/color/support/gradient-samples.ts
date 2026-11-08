import { blend, TRANSPARENT, type Rgba } from "../../../core/color"
import { px, styleOf } from "../../../core/page"
import type { ElementSnapshot, Rect } from "../../../types"
import { gradientStops, splitLayers } from "./gradients"

function length(value: string, size: number): number | null {
	if (value.endsWith("%")) return Number.parseFloat(value) * size / 100
	return px(value)
}

function position(value: string, space: number): number | null {
	if (value === "left" || value === "top") return 0
	if (value === "center") return space / 2
	if (value === "right" || value === "bottom") return space
	return length(value, space)
}

function fraction(image: string, x: number, y: number, w: number, h: number): readonly [number, number] | null {
	const head = splitLayers(image.slice(image.indexOf("(") + 1, -1))[0] ?? ""
	if (image.startsWith("linear-gradient(")) {
		let angle = Math.PI
		const degrees = /^(-?[\d.]+)deg$/.exec(head)
		if (degrees) angle = Number(degrees[1]) * Math.PI / 180
		else if (head.startsWith("to ")) {
			const dx = head.includes("right") ? 1 : head.includes("left") ? -1 : 0
			const dy = head.includes("bottom") ? 1 : head.includes("top") ? -1 : 0
			if (dx === 0 && dy === 0) return null
			angle = Math.atan2(dx * (dy === 0 ? 1 : h), -dy * (dx === 0 ? 1 : w))
		} else if (!gradientStops(`linear-gradient(${head})`).length) return null
		const span = Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle))
		return [((x - w / 2) * Math.sin(angle) - (y - h / 2) * Math.cos(angle)) / span + 0.5, span]
	}
	if (!image.startsWith("radial-gradient(")) return null
	const hasHead = gradientStops(`linear-gradient(${head})`).length === 0
	const [size = "", at = "50% 50%"] = hasHead ? head.split(/\s+at\s+/) : []
	const center = at.split(/\s+/)
	const cx = position(center[0] ?? "50%", w)
	const cy = position(center[1] ?? "50%", h)
	if (cx === null || cy === null) return null
	const explicit = size.split(/\s+/).filter((s) => /^[-\d.]+(?:px|%)$/.test(s))
	let rx = length(explicit[0] ?? "", w)
	let ry = length(explicit[1] ?? explicit[0] ?? "", h)
	if (rx === null || ry === null) {
		const close = size.includes("closest")
		const dx = close ? Math.min(Math.abs(cx), Math.abs(w - cx)) : Math.max(Math.abs(cx), Math.abs(w - cx))
		const dy = close ? Math.min(Math.abs(cy), Math.abs(h - cy)) : Math.max(Math.abs(cy), Math.abs(h - cy))
		const side = size.includes("side")
		if (size.includes("circle")) rx = ry = side ? close ? Math.min(dx, dy) : Math.max(dx, dy) : Math.hypot(dx, dy)
		else {
			rx = dx * (side ? 1 : Math.SQRT2)
			ry = dy * (side ? 1 : Math.SQRT2)
		}
	}
	return rx > 0 && ry > 0 ? [Math.hypot((x - cx) / rx, (y - cy) / ry), rx] : null
}

function colorAt(image: string, x: number, y: number, w: number, h: number): Rgba | null {
	const sample = fraction(image, x, y, w, h)
	const stops = gradientStops(image)
	if (!sample || stops.length < 2) return null
	const [t, span] = sample
	const positions = stops.map((stop) => {
		const token = /(-?[\d.]+)(%|px)\s*$/.exec(stop.raw)
		return token ? Number(token[1]) / (token[2] === "%" ? 100 : span) : null
	})
	positions[0] ??= 0
	positions[positions.length - 1] ??= 1
	let last = 0
	for (let i = 1; i < positions.length; i++) {
		const end = positions[i]
		if (end === null || end === undefined) continue
		const start = positions[last] ?? 0
		const edge = Math.max(start, end)
		for (let j = last + 1; j <= i; j++) positions[j] = start + (edge - start) * (j - last) / (i - last)
		last = i
	}
	let upper = positions.findIndex((p) => p !== null && t <= p)
	if (upper < 0) upper = stops.length - 1
	if (upper === 0) return stops[0]?.color ?? null
	const a = stops[upper - 1]?.color
	const b = stops[upper]?.color
	if (!a || !b) return null
	const start = positions[upper - 1] ?? 0
	const end = positions[upper] ?? 1
	const f = end === start ? 1 : Math.max(0, Math.min(1, (t - start) / (end - start)))
	const alpha = a.a * (1 - f) + b.a * f
	if (alpha === 0) return TRANSPARENT
	const mix = (v: number, u: number): number => (v * a.a * (1 - f) + u * b.a * f) / alpha
	return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), a: alpha }
}

/** Samples supported gradient tiles at the upstream text-box grid; null leaves the stop fallback in charge. */
export function gradientSamples(el: ElementSnapshot, text: Rect): readonly Rgba[] | null {
	const images = splitLayers(styleOf(el, "background-image"))
	if (images.some((image) => !/^(?:linear|radial)-gradient\(/.test(image))) return null
	const border = ["top", "right", "bottom", "left"].map((side) => px(styleOf(el, `border-${side}-width`)) ?? 0)
	const w = el.rect.width - (border[1] ?? 0) - (border[3] ?? 0)
	const h = el.rect.height - (border[0] ?? 0) - (border[2] ?? 0)
	if (w <= 0 || h <= 0) return null
	const sizes = splitLayers(styleOf(el, "background-size"))
	const positions = splitLayers(styleOf(el, "background-position"))
	const repeats = splitLayers(styleOf(el, "background-repeat"))
	const inset = Math.min(1, text.width / 4)
	const xs = [inset, text.width / 6, text.width / 2, text.width * 5 / 6, text.width - inset]
	const colors: Rgba[] = []
	for (const fy of [1 / 6, 0.5, 5 / 6]) for (const fx of xs) {
		let paint = TRANSPARENT
		for (let i = images.length - 1; i >= 0; i--) {
			const image = images[i]
			if (!image) continue
			const size = (sizes[i % sizes.length] ?? "auto").split(/\s+/)
			const tw = size[0] === "auto" ? w : length(size[0] ?? "100%", w)
			const th = !size[1] || size[1] === "auto" ? h : length(size[1], h)
			if (tw === null || th === null) return null
			if (tw <= 0 || th <= 0) continue
			const pos = (positions[i % positions.length] ?? "0% 0%").split(/\s+/)
			const tx = position(pos[0] ?? "0%", w - tw)
			const ty = position(pos[1] ?? "50%", h - th)
			if (tx === null || ty === null) return null
			let x = text.x + fx - el.rect.x - (border[3] ?? 0) - tx
			let y = text.y + text.height * fy - el.rect.y - (border[0] ?? 0) - ty
			const repeat = repeats[i % repeats.length] ?? "repeat"
			if (repeat === "repeat" || repeat === "repeat-x") x = ((x % tw) + tw) % tw
			else if (x < 0 || x > tw) continue
			if (repeat === "repeat" || repeat === "repeat-y") y = ((y % th) + th) % th
			else if (y < 0 || y > th) continue
			const color = colorAt(image, x, y, tw, th)
			if (!color) return null
			paint = blend(color, paint)
		}
		colors.push(paint)
	}
	return colors
}
