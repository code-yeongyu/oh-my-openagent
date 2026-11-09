import type { ElementSnapshot, PageSnapshot } from "../types"
import { blend, parseColor, type Rgba, WHITE } from "./color"

export const IGNORE_ATTRIBUTES = ["data-detect-ignore", "data-impeccable-ignore"] as const

/** Numeric value of a computed length in px ("12px" -> 12, "normal"/"auto" -> null). */
export function px(value: string | undefined): number | null {
	if (value === undefined) return null
	const m = /^(-?\d*\.?\d+)px$/.exec(value.trim())
	return m?.[1] === undefined ? null : Number.parseFloat(m[1])
}

export const styleOf = (el: ElementSnapshot, prop: string): string => el.style[prop] ?? ""

export function parentOf(snap: PageSnapshot, el: ElementSnapshot): ElementSnapshot | null {
	return el.parent === null ? null : (snap.elements[el.parent] ?? null)
}

export function* ancestors(snap: PageSnapshot, el: ElementSnapshot): Generator<ElementSnapshot> {
	let cur = parentOf(snap, el)
	while (cur) {
		yield cur
		cur = parentOf(snap, cur)
	}
}

export function* descendants(snap: PageSnapshot, el: ElementSnapshot): Generator<ElementSnapshot> {
	for (const i of el.children) {
		const child = snap.elements[i]
		if (!child) continue
		yield child
		yield* descendants(snap, child)
	}
}

export const childrenOf = (snap: PageSnapshot, el: ElementSnapshot): readonly ElementSnapshot[] =>
	el.children.map((i) => snap.elements[i]).filter((c): c is ElementSnapshot => c !== undefined)

/** Rendered and not visually suppressed: has a box, is not display:none/visibility:hidden, and no ancestor has opacity 0. */
export function isRendered(snap: PageSnapshot, el: ElementSnapshot): boolean {
	if (el.rect.width <= 0 || el.rect.height <= 0) return false
	if (styleOf(el, "display") === "none" || styleOf(el, "visibility") === "hidden") return false
	if (Number.parseFloat(styleOf(el, "opacity")) === 0) return false
	for (const a of ancestors(snap, el)) if (Number.parseFloat(styleOf(a, "opacity")) === 0) return false
	return true
}

/** True when the element or an ancestor waives `ruleId` with data-detect-ignore (or upstream's data-impeccable-ignore). */
export function isIgnored(snap: PageSnapshot, el: ElementSnapshot, ruleId: string): boolean {
	const waives = (e: ElementSnapshot): boolean =>
		IGNORE_ATTRIBUTES.some((name) => {
			const v = e.attributes[name]
			if (v === undefined) return false
			const ids = v.split(/[\s,]+/).filter(Boolean)
			return ids.length === 0 || ids.includes(ruleId) || ids.includes("all")
		})
	if (waives(el)) return true
	for (const a of ancestors(snap, el)) if (waives(a)) return true
	return false
}

/** The opaque color painted behind `el`: its own and its ancestors' background-colors composited bottom-up over white. */
export function effectiveBackground(snap: PageSnapshot, el: ElementSnapshot): Rgba {
	const layers: Rgba[] = []
	for (const e of [el, ...ancestors(snap, el)]) {
		const c = parseColor(styleOf(e, "background-color"))
		if (c && c.a > 0) {
			layers.push(c)
			if (c.a >= 1) break
		}
	}
	return layers.reduceRight<Rgba>((under, top) => blend(top, under), WHITE)
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const
export const isHeading = (el: ElementSnapshot): boolean => HEADING_TAGS.some((tag) => tag === el.tag)
export const headingLevel = (el: ElementSnapshot): number | null => (isHeading(el) ? Number(el.tag.slice(1)) : null)

export const textElements = (snap: PageSnapshot): readonly ElementSnapshot[] =>
	snap.elements.filter((el) => el.ownText !== "" && isRendered(snap, el))

export const fontSizePx = (el: ElementSnapshot): number => px(styleOf(el, "font-size")) ?? 16

export const shortSnippet = (el: ElementSnapshot): string => (el.text === "" ? `<${el.tag}>` : `<${el.tag}> ${el.text.slice(0, 80)}`)
