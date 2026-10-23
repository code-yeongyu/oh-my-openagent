import { classifyUtilityColor } from "./color"
import { type Corner, isInsetShadowStripe, MAX_BAR_PX, MIN_STRIPE_PX, parseLength } from "./declarations"
import type { RuleId } from "./findings"

const EXEMPT_VARIANT = /^(?:[\w-]+-)?(focus-visible|invalid|user-invalid|aria-invalid|aria-\[invalid[^\]]*\])$/
const BORDER_STYLE = new Set(["solid", "dashed", "dotted", "double", "hidden", "none"])
const SPACING_PX: Readonly<Record<string, number>> = { px: 1, "0.5": 2, "1": 4, "1.5": 6, "2": 8 }

type Utility = { readonly util: string; readonly layer: "base" | "before" | "after" }

function splitVariants(token: string): string[] {
	const parts: string[] = []
	let depth = 0
	let current = ""
	for (const ch of token) {
		if (ch === "[") depth += 1
		if (ch === "]") depth -= 1
		if (ch === ":" && depth === 0) {
			parts.push(current)
			current = ""
		} else current += ch
	}
	parts.push(current)
	return parts
}

function toUtility(token: string): Utility | undefined {
	const parts = splitVariants(token.trim())
	const util = (parts.pop() ?? "").replace(/^!|!$/g, "").replace(/^-/, "")
	if (!util || parts.some((v) => EXEMPT_VARIANT.test(v))) return undefined
	const layer = parts.includes("before") ? "before" : parts.includes("after") ? "after" : "base"
	return { util, layer }
}

function arbitraryPx(value: string): number | undefined {
	return value.startsWith("[") && value.endsWith("]") ? parseLength(value.slice(1, -1)) : undefined
}

const SIDE_TOUCHES: Readonly<Record<string, readonly Corner[]>> = {
	t: ["tl", "tr"], r: ["tr", "br"], b: ["br", "bl"], l: ["tl", "bl"], s: ["tl", "bl"], e: ["tr", "br"],
	x: ["tl", "tr", "br", "bl"], y: ["tl", "tr", "br", "bl"], bs: ["tl", "tr"], be: ["br", "bl"],
	tl: ["tl"], tr: ["tr"], br: ["br"], bl: ["bl"], ss: ["tl"], se: ["tr"], ee: ["br"], es: ["bl"],
}
const ALL: readonly Corner[] = ["tl", "tr", "br", "bl"]

const SIDE = /^(?:[tlrbsexy]|bs|be)-/

function isWide(width: string | undefined): boolean {
	if (!width) return false
	return ((/^\d+$/.test(width) ? Number.parseInt(width, 10) : arbitraryPx(width)) ?? 0) >= MIN_STRIPE_PX
}

function isWideSide(util: string): boolean {
	return isWide(/^border-(?:[tlrbsexy]|bs|be)-(\d+|\[[^\]]+\])$/.exec(util)?.[1])
}

function roundedCorners(utils: readonly string[]): Set<Corner> {
	const corners = new Set<Corner>()
	for (const util of utils) {
		const m = /^rounded(?:-(tl|tr|br|bl|ss|se|ee|es|[trblse]))?(?:-(.+))?$/.exec(util)
		if (!m) continue
		const touched = m[1] ? (SIDE_TOUCHES[m[1]] ?? []) : ALL
		const off = m[2] === "none" || m[2] === "0" || m[2] === "[0]" || m[2] === "[0px]"
		for (const c of touched) {
			if (off) corners.delete(c)
			else corners.add(c)
		}
	}
	return corners
}

function colorIsChromatic(fragment: string | undefined): boolean {
	if (!fragment || BORDER_STYLE.has(fragment) || /^\d+$/.test(fragment)) return false
	if (fragment.startsWith("[") && arbitraryPx(fragment) !== undefined) return false
	return classifyUtilityColor(fragment) === "chromatic"
}

function borderColorIsChromatic(util: string): boolean {
	return colorIsChromatic(/^border(?:-(?:[tlrbsexy]|bs|be))?-(.+)$/.exec(util)?.[1])
}

function hasOutline(utils: readonly string[]): boolean {
	const border = utils.some((u) => isWide(/^border-(\d+|\[[^\]]+\])$/.exec(u)?.[1]))
	const borderColor = utils.some((u) => {
		const fragment = /^border-(.+)$/.exec(u)?.[1]
		return fragment !== undefined && !SIDE.test(fragment) && colorIsChromatic(fragment)
	})
	const ring = utils.some((u) => isWide(/^ring-(\d+|\[[^\]]+\])$/.exec(u)?.[1]))
	const ringColor = utils.some((u) => {
		const fragment = /^ring-(.+)$/.exec(u)?.[1]
		return fragment !== undefined && !/^(?:inset|offset-)/.test(fragment) && colorIsChromatic(fragment)
	})
	return (border && borderColor) || (ring && ringColor)
}

function thinBar(utils: readonly string[], axis: "w" | "h"): boolean {
	return utils.some((u) => {
		const m = new RegExp(`^${axis}-(px|0\\.5|1|1\\.5|2|\\[[^\\]]+\\])$`).exec(u)
		if (!m?.[1]) return false
		const px = SPACING_PX[m[1]] ?? arbitraryPx(m[1])
		return px !== undefined && px > 0 && px <= MAX_BAR_PX
	})
}

function longBar(utils: readonly string[], axis: "w" | "h"): boolean {
	const full = axis === "h" ? ["h-full", "inset-y-0", "inset-0"] : ["w-full", "inset-x-0", "inset-0"]
	const pair = axis === "h" ? ["top-0", "bottom-0"] : ["left-0", "right-0"]
	return utils.some((u) => full.includes(u)) || pair.every((p) => utils.includes(p))
}

function isPseudoBar(utils: readonly string[]): boolean {
	const chromaticBg = utils.some((u) => u.startsWith("bg-") && classifyUtilityColor(u.slice(3)) === "chromatic")
	return chromaticBg && ((thinBar(utils, "w") && longBar(utils, "h")) || (thinBar(utils, "h") && longBar(utils, "w")))
}

export function checkClassSet(tokens: readonly string[], hostRounded = false): RuleId[] {
	const utilities = tokens.map(toUtility).filter((u): u is Utility => u !== undefined)
	const base = utilities.filter((u) => u.layer === "base").map((u) => u.util)
	const found: RuleId[] = []
	if (base.some(isWideSide) && base.some(borderColorIsChromatic)) found.push("edge-stripe")
	else if ((hostRounded || roundedCorners(base).size > 0) && hasOutline(base)) found.push("accent-outline")
	const shadows = base.filter((u) => u.startsWith("shadow-[") && u.endsWith("]"))
	if (shadows.some((u) => isInsetShadowStripe(u.slice("shadow-[".length, -1).replace(/_/g, " ")))) {
		found.push("inset-shadow-stripe")
	}
	for (const layer of ["before", "after"] as const) {
		const utils = utilities.filter((u) => u.layer === layer).map((u) => u.util)
		if (isPseudoBar(utils) && !found.includes("pseudo-bar")) found.push("pseudo-bar")
	}
	return found
}

export function looksLikeClassList(text: string): boolean {
	return /(?:^|\s)(?:[\w-]+:)*(?:rounded|border-|ring-|shadow-\[|(?:before|after):)/.test(text)
}
