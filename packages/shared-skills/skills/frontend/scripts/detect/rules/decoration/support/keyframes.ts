import type { ComputedStyle, PageSnapshot } from "../../../types"
import { splitTop } from "./appearance"
export type Frame = Readonly<Record<string, string>>
export type KeyframeStep = { readonly key: string; readonly declarations: Frame }
export function keyframeSteps(s: PageSnapshot, name: string): readonly KeyframeStep[] | null {
	const frames: KeyframeStep[] = []
	let found = false
	for (const css of s.cssText) {
		const text = css.replace(/\/\*[\s\S]*?\*\//g, "")
		for (const m of text.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g)) {
			if (m[1] !== name) continue
			found = true
			let end = (m.index ?? 0) + m[0].length,
				depth = 1
			const start = end
			while (end < text.length && depth > 0) {
				if (text[end] === "{") depth++
				if (text[end] === "}") depth--
				end++
			}
			for (const step of text.slice(start, end - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
				const entries = (step[2] ?? "").split(";").flatMap((d) => {
					const i = d.indexOf(":")
					return i < 0 ? [] : [[d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()]]
				})
				frames.push({ key: (step[1] ?? "").trim(), declarations: Object.fromEntries(entries) })
			}
		}
	}
	return found ? frames : null
}
export function keyframes(s: PageSnapshot, name: string): readonly Frame[] | null {
	return keyframeSteps(s, name)?.map(step => step.declarations) ?? null
}
export function infiniteNames(style: ComputedStyle): readonly string[] {
	const iterations = splitTop(style["animation-iteration-count"] ?? "")
	return splitTop(style["animation-name"] ?? "").filter((n, i) => n !== "none" && iterations[i % iterations.length] === "infinite")
}
export function onlyUnitPulse(frames: readonly Frame[]): boolean {
	return (
		frames.length > 0 &&
		frames.every((f) =>
			Object.entries(f).every(([p, v]) => {
				if (p === "opacity") return true
				if (p === "animation-timing-function") return !/linear\(|var\(/.test(v) && !overshoot(v)
				if (p !== "scale" && p !== "transform") return false
				if (v === "none") return true
				const rest = p === "scale" ? v : v.replace(/scale(?:[XYZ]|3d)?\(([^)]*)\)/gi, "$1")
				return (
					/^[\s,0-9.+-]+$/.test(rest) &&
					rest
						.split(/[\s,]+/)
						.filter(Boolean)
						.every((n) => Number(n) >= 0 && Number(n) <= 1)
				)
			}),
		)
	)
}
export const overshoot = (v: string): boolean =>
	[...v.matchAll(/cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)/g)].some((m) =>
		[Number(m[2]), Number(m[4])].some((y) => y < -0.1 || y > 1.1),
	)
const scalar = (v: string): number | null => (/^[-+]?(?:\d*\.)?\d+(?:px)?$/.test(v) ? Number.parseFloat(v) : null)
const differs = (a: string | undefined, b: string | undefined): boolean => {
	if (a === undefined || b === undefined) return false
	const x = scalar(a),
		y = scalar(b)
	return x !== null && y !== null ? Math.abs(x - y) >= 4 : a.replace(/\s/g, "") !== b.replace(/\s/g, "")
}
function translation(f: Frame): readonly string[] | null {
	const t = f["transform"]
	if (t === undefined && f["translate"] === undefined) return null
	if (t?.includes("matrix")) return []
	const axes = ["0", "0", "0"]
	for (const m of (t ?? "").matchAll(/translate([XYZ]|3d)?\(([^)]*)\)/gi)) {
		const suffix = m[1]?.toLowerCase(),
			args = (m[2] ?? "").split(/,\s*/).map((x) => x.trim())
		if (suffix === "x" || suffix === "y" || suffix === "z") axes[suffix === "x" ? 0 : suffix === "y" ? 1 : 2] = args[0] ?? "0"
		else
			args.forEach((v, i) => {
				axes[i] = v
			})
	}
	if (f["translate"])
		f["translate"].split(/\s+/).forEach((v, i) => {
			axes[i] = v
		})
	return axes
}
export function dotPulse(frames: readonly Frame[]): boolean {
	const declarations = frames.flatMap((f) => Object.entries(f))
	const scales = declarations
		.filter(([p]) => p === "transform")
		.flatMap(([, v]) => [...v.matchAll(/scale([XY]|3d)?\(/gi)].map((m) => m[1] ?? "both"))
	const oneAxis =
		scales.length > 0 &&
		new Set(scales).size === 1 &&
		["X", "Y", "x", "y"].includes(scales[0] ?? "") &&
		!declarations.some(([p]) => p === "scale")
	const signal = declarations.some(
		([p, v]) => p === "opacity" || p === "box-shadow" || p === "scale" || (p === "transform" && /scale/i.test(v) && !oneAxis),
	)
	if (!signal) return false
	const translations = frames.map(translation).filter((t): t is readonly string[] => t !== null)
	for (const a of translations)
		for (const b of translations)
			for (let i = 0; i < 3; i++) {
				const x = a[i] ?? "0",
					y = b[i] ?? "0"
				if (!x.includes("%") && !y.includes("%") && differs(x, y)) return false
			}
	const sizes = frames.filter((f) => f["height"] !== undefined)
	if (sizes.some((f) => f["height"] !== sizes[0]?.["height"]) && sizes.every((f) => f["width"] === sizes[0]?.["width"])) return false
	const pairs = [
		["left", "right"],
		["top", "bottom"],
		["inset-inline-start", "inset-inline-end"],
		["inset-block-start", "inset-block-end"],
		["margin-left", "margin-right"],
		["margin-top", "margin-bottom"],
		["margin-inline-start", "margin-inline-end"],
		["margin-block-start", "margin-block-end"],
	]
	for (const a of frames)
		for (const b of frames) {
			if (differs(a["width"], b["width"]) || differs(a["height"], b["height"])) continue
			for (const [x = "", y = ""] of pairs) if (differs(a[x], b[x]) !== differs(a[y], b[y])) return false
		}
	return true
}
export const toggles = (frames: readonly Frame[]): boolean =>
	frames.some((f) => Number(f["opacity"] ?? 1) <= 0.15 || f["visibility"] === "hidden") &&
	frames.every((f) => Object.keys(f).every((p) => ["opacity", "visibility", "animation-timing-function"].includes(p)))
