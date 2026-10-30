import type { PageRule } from "../../rule"
import { ancestors, descendants, shortSnippet, styleOf } from "../../core/page"
import { visible } from "./support/appearance"
import { infiniteNames, keyframes } from "./support/keyframes"
import { pageIgnored } from "../color/support/page-ignore"
import type { PageSnapshot } from "../../types"

function marqueeKeyframes(snapshot: PageSnapshot, name: string): boolean {
	const frames = keyframes(snapshot, name)
	if (frames === null) return /marquee|ticker|crawl|scroll/i.test(name)
	const percentages = frames.flatMap((frame) => [...(frame["transform"] ?? "").matchAll(/\btranslate(?:x|3d)?\(\s*(?:calc\(\s*)?(-?[\d.]+)%/gi)]
		.map((match) => Number(match[1])))
	if (percentages.length === 0 || (percentages.length === 1 && frames.some((frame) =>
		frame["opacity"] !== undefined || /\bscale\(/i.test(frame["transform"] ?? "")))) return false
	const travel = percentages.length === 1 ? Math.abs(percentages[0] ?? 0) : Math.max(...percentages) - Math.min(...percentages)
	return travel >= 20
}
export const marquee: PageRule = {
	meta: {
		id: "marquee",
		name: "Auto-scrolling marquee",
		category: "slop",
		severity: "warning",
		engine: "page",
		description: "Content crawls automatically through a repeating horizontal loop.",
		fixHint: "Keep the content still and let readers scroll it themselves.",
	},
	check: ({ snapshot }) => {
		const seen = new Set<number>()
		const strips = new Set<number>()
		return snapshot.elements.flatMap((e) => {
			if (!visible(snapshot, e) || pageIgnored(snapshot, e, "marquee") || [...ancestors(snapshot, e)].some((a) => seen.has(a.index))) return []
			const carries =
				e.text.trim() !== "" ||
				[...descendants(snapshot, e)].some(
					(c) =>
						["img", "picture", "video", "canvas", "iframe", "object", "embed", "marquee"].includes(c.tag) ||
						(c.tag === "svg" && c.attributes["aria-hidden"] !== "true"),
				)
			const loop = (style: Readonly<Record<string, string>>): boolean =>
				infiniteNames(style).some((name) => marqueeKeyframes(snapshot, name))
			const pseudo = [e.before, e.after].some((p) => p && loop(p.style) && !["", '""', "none", "normal"].includes(p.style["content"] ?? ""))
			if (e.tag !== "marquee" && !(carries && loop(e.style)) && !pseudo) return []
			const strip = [...ancestors(snapshot, e)].find((a) => ["hidden", "clip", "scroll", "auto"].includes(styleOf(a, "overflow-x")))
			if (strip && strips.has(strip.index)) return []
			if (strip) strips.add(strip.index)
			seen.add(e.index)
			return [{ element: e, message: "Continuously scrolling content track", snippet: shortSnippet(e) }]
		})
	},
}
