import type { PageRule } from "../../rule"
import { ancestors, descendants, shortSnippet } from "../../core/page"
import { visible } from "./support/appearance"
export const shapeAssembledIllustration: PageRule = {
	meta: {
		id: "shape-assembled-illustration",
		name: "Shape-assembled illustration",
		category: "slop",
		severity: "advisory",
		engine: "page",
		description: "A hero-sized SVG scene is assembled mainly from primitive shapes.",
		fixHint: "Use produced artwork, a photograph, or a deliberately drawn illustration.",
	},
	check: ({ snapshot }) =>
		snapshot.elements.flatMap((e) => {
			if (e.tag !== "svg" || !visible(snapshot, e) || e.rect.width < 200 || e.rect.height < 200) return []
			const all = [...descendants(snapshot, e)]
			if (all.filter((n) => n.tag === "text").length > 2 || all.some((n) => n.tag === "pattern")) return []
			const primitive = (tag: string): boolean => ["rect", "circle", "ellipse", "polygon"].includes(tag)
			const drawn = (tag: string): boolean => primitive(tag) || ["path", "line", "polyline"].includes(tag)
			const painted = all.filter((n) => ![...ancestors(snapshot, n)].some((a) => a.tag === "defs"))
			const used = painted
				.filter((n) => n.tag === "use")
				.flatMap((n) => {
					const id = (n.attributes["href"] ?? n.attributes["xlink:href"] ?? "").replace(/^#/, "")
					const target = all.find((a) => a.attributes["id"] === id && drawn(a.tag))
					return target ? [target] : []
				})
			const shapes = [...painted, ...used],
				primitives = shapes.filter((n) => primitive(n.tag))
			if (primitives.length < 8 || primitives.length < shapes.filter((n) => drawn(n.tag)).length * 0.5) return []
			const fills = new Set(
				[e, ...all]
					.map((n) => n.attributes["fill"]?.toLowerCase())
					.filter((v) => v !== undefined && !["none", "transparent", "currentcolor", "inherit", ""].includes(v)),
			)
			if (fills.size < 3) return []
			const rects = primitives
				.filter((n) => n.tag === "rect")
				.map((n) => ({ w: Number(n.attributes["width"]), h: Number(n.attributes["height"]) }))
				.filter((r) => Number.isFinite(r.w) && Number.isFinite(r.h))
			if (
				primitives.length <= 400 &&
				primitives.filter((n) => ["circle", "ellipse", "polygon"].includes(n.tag)).length < primitives.length * 0.25
			) {
				const series = rects.some((a) => {
					const sameWidth = rects.filter((b) => Math.abs(a.w - b.w) <= 1),
						sameHeight = rects.filter((b) => Math.abs(a.h - b.h) <= 1)
					return (
						(sameWidth.length >= primitives.length / 2 && sameWidth.some((b) => Math.abs(b.h - a.h) > 1)) ||
						(sameHeight.length >= primitives.length / 2 && sameHeight.some((b) => Math.abs(b.w - a.w) > 1))
					)
				})
				if (series) return []
			}
			return [{ element: e, message: "Large SVG scene assembled from " + primitives.length + " primitives", snippet: shortSnippet(e) }]
		}),
}
