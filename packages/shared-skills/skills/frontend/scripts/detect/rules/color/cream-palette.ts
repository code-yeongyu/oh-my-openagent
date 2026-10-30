import { parseColor, type Rgba } from "../../core/color"
import { isRendered, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"

const cream = (c: Rgba | null): boolean => c !== null && Math.min(c.r, c.g, c.b) >= 209 && c.r >= c.g && c.g >= c.b && c.r - c.b >= 6 && c.r - c.b <= 48
const CREAM_CLASSES = ["bg-amber-50", "bg-orange-50", "bg-yellow-50", "bg-orange-100"] as const

export const creamPalette: PageRule = {
	meta: {
		id: "cream-palette", name: "Cream / beige palette", category: "slop", severity: "warning", engine: "page",
		description: "The page defaults to a warm cream or beige ground.",
		fixHint: "Choose a page surface that follows the project's palette.",
	},
	check: ({ snapshot }) => {
		const body = snapshot.elements.find((el) => el.tag === "body")
		const html = snapshot.elements.find((el) => el.tag === "html")
		if (!body) return []
		let fill = parseColor(styleOf(body, "background-color"))
		if (!fill || fill.a === 0) fill = html ? parseColor(styleOf(html, "background-color")) : null
		const classes = [body, html].flatMap((el) => (el?.attributes["class"] ?? "").split(/\s+/))
		const classCream = classes.some((c) => CREAM_CLASSES.some((known) => known === c) || (c.startsWith("bg-[") && cream(parseColor(c.slice(4, -1).replaceAll("_", " ")))))
		if (!cream(fill) && !classCream) return []
		const bands = snapshot.elements.filter((el) => el !== body && el !== html && isRendered(snapshot, el) && el.rect.width >= snapshot.viewport.width * 0.9)
		const covering = bands.filter((el) => {
			const c = parseColor(styleOf(el, "background-color"))
			return c !== null && c.a >= 0.95 && el.rect.height >= snapshot.viewport.height * 0.9
		}).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]
		if (covering) {
			const c = parseColor(styleOf(covering, "background-color"))
			const near = c !== null && Math.min(c.r, c.g, c.b) >= 209 && c.r >= c.g && c.g >= c.b && c.r - c.b >= 2 && c.r - c.b <= 48
			if (!cream(c) && !near && !bands.some((el) => cream(parseColor(styleOf(el, "background-color"))))) return []
		}
		return [{ element: body, message: "The page uses a cream or beige background", snippet: "<body>" }]
	},
}
