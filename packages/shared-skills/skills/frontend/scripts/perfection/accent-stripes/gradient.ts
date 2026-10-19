import { classifyColor, looksLikeColor } from "./color"
import { type Declaration, splitTopLevel } from "./css-parse"
import { isBackground, MAX_BAR_PX, parseLength } from "./declarations"

type Stop = { readonly chromatic: boolean; readonly positions: readonly string[] }
type Edge = { readonly near: number } | { readonly far: number }

function linearGradientBodies(value: string): string[] {
	const bodies: string[] = []
	for (const m of value.matchAll(/(?<![\w-])linear-gradient\(/gi)) {
		const start = (m.index ?? 0) + m[0].length
		let depth = 1
		let i = start
		for (; i < value.length && depth > 0; i += 1) {
			if (value.charAt(i) === "(") depth += 1
			if (value.charAt(i) === ")") depth -= 1
		}
		bodies.push(value.slice(start, i - 1))
	}
	return bodies
}

function stopsOf(body: string): Stop[] {
	return splitTopLevel(body, ",").flatMap((arg) => {
		const [color = "", ...positions] = splitTopLevel(arg, " ")
		if (!looksLikeColor(color)) return []
		return [{ chromatic: classifyColor(color) === "chromatic", positions }]
	})
}

function edgeOf(position: string | undefined): Edge | undefined {
	if (position === undefined) return undefined
	const far = /^calc\(\s*100%\s*-\s*([\d.]+(?:px|rem|em)?)\s*\)$/i.exec(position)
	if (far?.[1]) {
		const px = parseLength(far[1])
		return px === undefined ? undefined : { far: px }
	}
	const px = parseLength(position)
	return px === undefined ? undefined : { near: px }
}

const nearPx = (edge: Edge | undefined): number | undefined => (edge && "near" in edge ? edge.near : undefined)
const farPx = (edge: Edge | undefined): number | undefined => (edge && "far" in edge ? edge.far : undefined)
const isBand = (px: number | undefined): px is number => px !== undefined && px > 0 && px <= MAX_BAR_PX

function isEdgeBand(stops: readonly Stop[]): boolean {
	return stops.some((stop, i) => {
		if (!stop.chromatic) return false
		const end = nearPx(edgeOf(stop.positions.at(-1)))
		const nextStart = nearPx(edgeOf(stops[i + 1]?.positions[0]))
		if (isBand(end) && nextStart !== undefined && nextStart <= end) return true
		const start = farPx(edgeOf(stop.positions[0]))
		const prevEnd = farPx(edgeOf(stops[i - 1]?.positions.at(-1)))
		return isBand(start) && prevEnd !== undefined && prevEnd <= start
	})
}

function isTiled(declarations: readonly Declaration[]): boolean {
	return declarations.some(
		({ prop, value }) =>
			prop === "background-size" && splitTopLevel(value, ",").some((layer) => splitTopLevel(layer, " ").some((t) => parseLength(t) !== undefined)),
	)
}

export function hasGradientEdgeBand(declarations: readonly Declaration[]): boolean {
	if (isTiled(declarations)) return false
	return declarations.some(
		({ prop, value }) => isBackground(prop) && linearGradientBodies(value).some((body) => isEdgeBand(stopsOf(body))),
	)
}
