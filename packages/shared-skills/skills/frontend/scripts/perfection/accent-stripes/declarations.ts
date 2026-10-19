import { type ColorClass, classifyColor, containsChromatic, looksLikeColor } from "./color"
import { type Declaration, splitTopLevel } from "./css-parse"

export const MIN_STRIPE_PX = 2
export const MAX_BAR_PX = 8

const SIDES = ["top", "right", "bottom", "left"] as const
export type Side = (typeof SIDES)[number]
type Edge = { width?: number; color?: ColorClass; hidden?: boolean }

const LOGICAL_SIDE: Readonly<Record<string, Side>> = {
	top: "top", right: "right", bottom: "bottom", left: "left",
	"block-start": "top", "inline-end": "right", "block-end": "bottom", "inline-start": "left",
}

export function parseLength(token: string): number | undefined {
	const keyword: Readonly<Record<string, number>> = { thin: 1, medium: 3, thick: 5 }
	const t = token.trim().toLowerCase()
	if (t in keyword) return keyword[t]
	const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(t)
	if (!m?.[1]) return undefined
	const n = Number.parseFloat(m[1])
	return m[2] === "rem" || m[2] === "em" ? n * 16 : n
}

function percent(token: string | undefined): number | undefined {
	const m = token ? /^(\d*\.?\d+)%$/.exec(token.trim()) : null
	return m?.[1] ? Number.parseFloat(m[1]) : undefined
}

function boxValues(value: string): [string, string, string, string] {
	const v = splitTopLevel(value, " ")
	const [a = "", b = a, c = a, d = b] = v
	return [a, b, c, d]
}

function parseEdgeShorthand(value: string): Edge {
	const edge: Edge = {}
	for (const token of splitTopLevel(value, " ")) {
		if (looksLikeColor(token)) edge.color = classifyColor(token)
		else if (/^(none|hidden)$/i.test(token)) edge.hidden = true
		else {
			const length = parseLength(token)
			if (length !== undefined) edge.width = length
		}
	}
	return edge
}

function collectEdges(declarations: readonly Declaration[]): Map<Side, Edge> {
	const edges = new Map<Side, Edge>(SIDES.map((s) => [s, {}]))
	const merge = (side: Side, patch: Edge) => edges.set(side, { ...edges.get(side), ...patch })
	let imageChromatic = false
	for (const { prop, value } of declarations) {
		if (prop === "border-image" || prop === "border-image-source") imageChromatic = containsChromatic(value)
		else if (prop === "border") SIDES.forEach((s) => merge(s, parseEdgeShorthand(value)))
		else if (prop === "border-width") boxValues(value).forEach((v, i) => merge(SIDES[i] ?? "top", { width: parseLength(v) ?? 0 }))
		else if (prop === "border-color") boxValues(value).forEach((v, i) => merge(SIDES[i] ?? "top", { color: classifyColor(v) }))
		else {
			const m = /^border-(top|right|bottom|left|block-start|block-end|inline-start|inline-end)(?:-(width|color))?$/.exec(prop)
			const side = m?.[1] ? LOGICAL_SIDE[m[1]] : undefined
			if (!side) continue
			if (m?.[2] === "width") merge(side, { width: parseLength(value) ?? 0 })
			else if (m?.[2] === "color") merge(side, { color: classifyColor(value) })
			else merge(side, parseEdgeShorthand(value))
		}
	}
	if (imageChromatic) {
		for (const side of SIDES) if ((edges.get(side)?.width ?? 0) > 0) merge(side, { color: "chromatic" })
	}
	return edges
}

export type Corner = "tl" | "tr" | "br" | "bl"
export const ALL_CORNERS: ReadonlySet<Corner> = new Set(["tl", "tr", "br", "bl"])
export const SIDE_CORNERS: Readonly<Record<Side, readonly [Corner, Corner]>> = {
	top: ["tl", "tr"], right: ["tr", "br"], bottom: ["br", "bl"], left: ["tl", "bl"],
}
const CORNER_LONGHAND: Readonly<Record<string, Corner>> = {
	"top-left": "tl", "top-right": "tr", "bottom-right": "br", "bottom-left": "bl",
	"start-start": "tl", "start-end": "tr", "end-end": "br", "end-start": "bl",
}

const nonZero = (token: string) => (parseLength(token) ?? percent(token) ?? 1) > 0

export function roundedCorners(declarations: readonly Declaration[]): Set<Corner> {
	const corners = new Set<Corner>()
	for (const { prop, value } of declarations) {
		if (prop === "border-radius") {
			const [tl, tr, br, bl] = boxValues(value.split("/")[0] ?? "")
			const values: Array<[Corner, string]> = [["tl", tl], ["tr", tr], ["br", br], ["bl", bl]]
			for (const [corner, v] of values) {
				if (nonZero(v)) corners.add(corner)
				else corners.delete(corner)
			}
			continue
		}
		const m = /^border-([a-z]+-[a-z]+)-radius$/.exec(prop)
		const corner = m?.[1] ? CORNER_LONGHAND[m[1]] : undefined
		if (!corner) continue
		if (nonZero(splitTopLevel(value, " ")[0] ?? "0")) corners.add(corner)
		else corners.delete(corner)
	}
	return corners
}

export function hasEdgeStripe(declarations: readonly Declaration[], corners: ReadonlySet<Corner> = ALL_CORNERS): boolean {
	const bySide = collectEdges(declarations)
	const edges = [...bySide.values()]
	const isStripe = (e: Edge) => !e.hidden && (e.width ?? 0) >= MIN_STRIPE_PX && e.color === "chromatic"
	const bent = SIDES.some((s) => {
		const edge = bySide.get(s)
		return edge !== undefined && isStripe(edge) && SIDE_CORNERS[s].some((c) => corners.has(c))
	})
	if (!bent) return false
	const first = edges[0]
	const uniform = edges.every((e) => e.width === first?.width && e.color === first?.color && e.hidden === first?.hidden)
	return !uniform
}

export function hasRadius(declarations: readonly Declaration[]): boolean {
	return roundedCorners(declarations).size > 0
}

export function isInsetShadowStripe(value: string): boolean {
	return splitTopLevel(value, ",").some((layer) => {
		const tokens = splitTopLevel(layer, " ")
		if (!tokens.some((t) => t.toLowerCase() === "inset")) return false
		const lengths = tokens.map(parseLength).filter((n): n is number => n !== undefined)
		const [x = 0, y = 0, blur = 0] = lengths
		const oneSided = (Math.abs(x) >= MIN_STRIPE_PX) !== (Math.abs(y) >= MIN_STRIPE_PX) && (x === 0 || y === 0)
		return oneSided && blur === 0 && tokens.some((t) => looksLikeColor(t) && classifyColor(t) === "chromatic")
	})
}

export function hasInsetShadowStripe(declarations: readonly Declaration[]): boolean {
	return declarations.some(({ prop, value }) => prop === "box-shadow" && isInsetShadowStripe(value))
}

export const isBackground = (prop: string) => prop === "background" || prop === "background-color" || prop === "background-image"

function backgroundIsChromatic(declarations: readonly Declaration[]): boolean {
	return declarations.some(({ prop, value }) => isBackground(prop) && containsChromatic(value))
}

export function isPseudoBar(declarations: readonly Declaration[]): boolean {
	if (!backgroundIsChromatic(declarations)) return false
	const get = (name: string) => declarations.findLast((d) => d.prop === name)?.value
	const has = (name: string) => get(name) !== undefined
	const thin = (name: string) => {
		const n = parseLength(get(name) ?? "")
		return n !== undefined && n > 0 && n <= MAX_BAR_PX
	}
	const long = (name: string, a: string, b: string) => (percent(get(name)) ?? 0) >= 50 || (has(a) && has(b)) || has("inset")
	return (thin("width") && long("height", "top", "bottom")) || (thin("height") && long("width", "left", "right"))
}
