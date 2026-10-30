export type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }
export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

const clamp255 = (n: number): number => Math.max(0, Math.min(255, n))

function parseHex(hex: string): Rgba | null {
	const h = hex.slice(1)
	const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h
	if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return null
	const n = (i: number): number => Number.parseInt(full.slice(i, i + 2), 16)
	return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 }
}

function channel(token: string, scale: number): number {
	return token.endsWith("%") ? (Number.parseFloat(token) / 100) * scale : Number.parseFloat(token)
}

function oklabToRgb(l: number, a: number, b: number): readonly [number, number, number] {
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
	const lin = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	] as const
	const gamma = (c: number): number => clamp255(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
	return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2])]
}

type Vec3 = readonly [number, number, number]
const mul = (m: readonly Vec3[], v: Vec3): Vec3 => {
	const row = (i: number): Vec3 => m[i] ?? [0, 0, 0]
	const dot = (r: Vec3): number => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]
	return [dot(row(0)), dot(row(1)), dot(row(2))]
}
const XYZ_D65_TO_LINEAR_SRGB: readonly Vec3[] = [
	[3.2409699419, -1.5373831776, -0.4986107603],
	[-0.9692436363, 1.8759675015, 0.0415550574],
	[0.0556300797, -0.2039769589, 1.0569715142],
]
const LINEAR_P3_TO_XYZ_D65: readonly Vec3[] = [
	[0.4865709486, 0.2656676932, 0.1982172852],
	[0.2289745641, 0.6917385218, 0.0792869141],
	[0, 0.0451133819, 1.0439443689],
]
const XYZ_D50_TO_D65: readonly Vec3[] = [
	[0.9554734528, -0.0230985368, 0.0632593086],
	[-0.0283697094, 1.0099954580, 0.0210413990],
	[0.0123140016, -0.0205076964, 1.3303659366],
]
const toLinear = (c: number): number => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4)
const encode = (lin: Vec3): Vec3 => {
	const gamma = (c: number): number => clamp255(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
	return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2])]
}

function labToRgb(l: number, a: number, b: number): Vec3 {
	const fy = (l + 16) / 116
	const [fx, fz] = [fy + a / 500, fy - b / 200]
	const inv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))
	const xyzD50: Vec3 = [0.3457 / 0.3585 * inv(fx), l > 8 ? fy ** 3 : l / (24389 / 27), (1 - 0.3457 - 0.3585) / 0.3585 * inv(fz)]
	return encode(mul(XYZ_D65_TO_LINEAR_SRGB, mul(XYZ_D50_TO_D65, xyzD50)))
}

function predefinedToRgb(space: string, c: Vec3): Vec3 | null {
	if (space === "srgb") return [clamp255(c[0] * 255), clamp255(c[1] * 255), clamp255(c[2] * 255)]
	if (space === "srgb-linear") return encode(c)
	if (space === "display-p3") return encode(mul(XYZ_D65_TO_LINEAR_SRGB, mul(LINEAR_P3_TO_XYZ_D65, [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])])))
	return null
}

/** Parses the color forms getComputedStyle returns (rgb/rgba, color(srgb | srgb-linear | display-p3), lab/lch, oklab/oklch) plus hex and `transparent`; other spaces return null. Out-of-gamut values are clamped to sRGB. */
export function parseColor(input: string): Rgba | null {
	const s = input.trim().toLowerCase()
	if (s === "transparent") return TRANSPARENT
	if (s.startsWith("#")) return parseHex(s)
	const m = /^(rgba?|color|oklab|oklch|lab|lch)\((.*)\)$/.exec(s)
	if (!m) return null
	const [, fn, body = ""] = m
	const [main = "", alphaPart] = body.split("/")
	const parts = main.replace(/,/g, " ").split(/\s+/).filter(Boolean)
	const commaAlpha = fn?.startsWith("rgb") && parts.length === 4 ? parts[3] : undefined
	const alphaToken = alphaPart?.trim() ?? commaAlpha
	const a = alphaToken === undefined ? 1 : channel(alphaToken, 1)
	if (fn === "rgb" || fn === "rgba") return { r: channel(parts[0] ?? "0", 255), g: channel(parts[1] ?? "0", 255), b: channel(parts[2] ?? "0", 255), a }
	if (fn === "color") {
		const rgb = predefinedToRgb(parts[0] ?? "", [channel(parts[1] ?? "0", 1), channel(parts[2] ?? "0", 1), channel(parts[3] ?? "0", 1)])
		return rgb ? { r: rgb[0], g: rgb[1], b: rgb[2], a } : null
	}
	if (fn === "lab" || fn === "lch") {
		const l = channel(parts[0] ?? "0", 100)
		const [q1, q2] = [Number.parseFloat(parts[1] ?? "0"), Number.parseFloat(parts[2] ?? "0")]
		const [la, lb] = fn === "lch" ? [q1 * Math.cos((q2 * Math.PI) / 180), q1 * Math.sin((q2 * Math.PI) / 180)] : [q1, q2]
		const [r, g, b] = labToRgb(l, la, lb)
		return { r, g, b, a }
	}
	const l = channel(parts[0] ?? "0", 1)
	const [p1, p2] = [Number.parseFloat(parts[1] ?? "0"), Number.parseFloat(parts[2] ?? "0")]
	const [oa, ob] = fn === "oklch" ? [p1 * Math.cos((p2 * Math.PI) / 180), p1 * Math.sin((p2 * Math.PI) / 180)] : [p1, p2]
	const [r, g, b] = oklabToRgb(l, oa, ob)
	return { r, g, b, a }
}

/** Source-over compositing of `top` onto an opaque `bottom`. */
export function blend(top: Rgba, bottom: Rgba): Rgba {
	const a = top.a + bottom.a * (1 - top.a)
	if (a === 0) return TRANSPARENT
	const mix = (t: number, b: number): number => (t * top.a + b * bottom.a * (1 - top.a)) / a
	return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a }
}

/** WCAG 2.x relative luminance. */
export function luminance(c: Rgba): number {
	const lin = (v: number): number => {
		const s = v / 255
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** WCAG 2.x contrast ratio between two opaque colors, 1..21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

export function toHsl(c: Rgba): { readonly h: number; readonly s: number; readonly l: number } {
	const [r, g, b] = [c.r / 255, c.g / 255, c.b / 255]
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2
	if (max === min) return { h: 0, s: 0, l }
	const d = max - min
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	return { h: h * 60, s, l }
}

/** Every color literal inside a computed value such as `box-shadow` or `background-image`. */
export function colorsIn(value: string): readonly Rgba[] {
	const out: Rgba[] = []
	for (const m of value.matchAll(/(rgba?|color|oklab|oklch|lab|lch)\([^()]*\)|#[0-9a-f]{3,8}\b/gi)) {
		const c = parseColor(m[0])
		if (c) out.push(c)
	}
	return out
}
