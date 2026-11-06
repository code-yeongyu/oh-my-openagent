import type { PageHit, PageRule } from "../../rule"
import type { ComputedStyle, ElementSnapshot, PageSnapshot } from "../../types"
import { ancestors, shortSnippet, styleOf } from "../../core/page"
import { radii, splitTop } from "./support/appearance"
import { cssCandidates, matchesSelector } from "./support/css-candidates"
import { dotPulse, infiniteNames, keyframes } from "./support/keyframes"

function pulses(s: PageSnapshot, style: ComputedStyle): boolean {
	const shorthand = splitTop(style["animation"] ?? "").filter(v => /\binfinite\b/.test(v))
	const names = [...infiniteNames(style), ...shorthand.flatMap(v => v.split(/\s+/).filter(n => keyframes(s, n) !== null || /pulse|ping|ripple|beacon/i.test(n)))]
	return names.some(n => {
		const frames = keyframes(s, n)
		return frames === null ? /pulse|ping|ripple|beacon/i.test(n) : dotPulse(frames)
	})
}
const shown = (s: PageSnapshot, e: ElementSnapshot): boolean =>
	[e, ...ancestors(s, e)].every(n => styleOf(n, "display") !== "none" && styleOf(n, "visibility") !== "hidden" &&
		Number.parseFloat(styleOf(n, "opacity")) !== 0 && n.attributes["hidden"] === undefined)
const dotSize = (w: number, h: number): boolean =>
	w >= 2 && h >= 2 && w <= 16 && h <= 16 && Math.max(w, h) <= 1.5 * Math.min(w, h)

export const pulsingDot: PageRule = {
	meta: {
		id: "pulsing-dot", name: "Pulsing status dot", category: "slop", severity: "warning", engine: "page",
		description: "A tiny circular indicator pulses continuously.",
		fixHint: "Keep the indicator static unless it represents live changing data.",
	},
	check: ({ snapshot }) => {
		const hits: PageHit[] = []
		const covered = new Set<number>()
		const candidates = cssCandidates(snapshot)
		const vars = new Map([...candidates.values()].flatMap(d => Object.entries(d).filter(([p]) => p.startsWith("--"))))
		const length = (value: string): number => {
			const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars.get(name) ?? "")
			const m = /^([\d.]+)(px|rem|em)?$/.exec(resolved)
			return m ? Number(m[1]) * (m[2] === "rem" || m[2] === "em" ? 16 : 1) : Number.NaN
		}
		for (const [selector, style] of candidates) {
			const w = length(style["width"] ?? style["inline-size"] ?? ""), h = length(style["height"] ?? style["block-size"] ?? "")
			const radius = style["border-radius"] ?? ""
			if (!dotSize(w, h) || !pulses(snapshot, style) ||
				!radius.split(/[\s/]+/).every(r => r.endsWith("%") ? Number.parseFloat(r) >= 40 : length(r) >= Math.min(w, h) * 0.4)) continue
			const matches = snapshot.elements.filter(e => matchesSelector(snapshot, e, selector) && shown(snapshot, e))
			const first = matches[0]
			if (!first) continue
			matches.forEach(e => covered.add(e.index))
			hits.push({ element: first, message: "Infinitely pulsing " + w + "x" + h + "px status dot", snippet: shortSnippet(first) })
		}
		const tailwind = new Set<string>()
		for (const e of snapshot.elements) {
			const classes = e.attributes["class"] ?? ""
			if (/(?:^|\s)animate-(?:ping|pulse)(?:$|\s)/.test(classes) && /(?:^|\s)rounded-full(?:$|\s)/.test(classes) &&
				/(?:^|\s)[wh]-(?:0\.5|1|1\.5|2|2\.5|3|3\.5|4)(?:$|\s)/.test(classes)) {
				const side = (name: string): number | undefined => {
					const value = new RegExp("(?:^|\\s)" + name + "-([\\d.]+)(?:$|\\s)").exec(classes)?.[1]
					return value === undefined ? undefined : Number(value) * 4
				}
				const w = side("w"), h = side("h")
				if ((w === undefined || h === undefined || dotSize(w, h)) && !tailwind.has(classes)) {
					tailwind.add(classes)
					covered.add(e.index)
					hits.push({ element: e, message: "Infinitely pulsing utility status dot", snippet: shortSnippet(e) })
				}
			}
			if (covered.has(e.index) || !shown(snapshot, e) || !pulses(snapshot, e.style)) continue
			const w = e.rect.width, h = e.rect.height
			if (dotSize(w, h) && radii(e).every(r => r >= Math.min(w, h) * 0.4))
				hits.push({ element: e, message: "Infinitely pulsing " + w + "x" + h + "px status dot", snippet: shortSnippet(e) })
		}
		return hits
	},
}
