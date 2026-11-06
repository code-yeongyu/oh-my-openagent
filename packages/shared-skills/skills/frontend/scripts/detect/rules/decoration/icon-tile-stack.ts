import type { PageRule } from "../../rule"
import { childrenOf, descendants, fontSizePx, isHeading, shortSnippet, styleOf } from "../../core/page"
import { parseColor } from "../../core/color"
import { parseShadow } from "../../core/shadow"
import { length, radii, visible } from "./support/appearance"
import { labelBefore, nearAbove } from "./support/labels"
export const iconTileStack: PageRule = {
	meta: {
		id: "icon-tile-stack",
		name: "Icon tile stacked above heading",
		category: "slop",
		severity: "warning",
		engine: "page",
		description: "A small framed icon tile sits above a heading.",
		fixHint: "Put the icon beside the title or remove its separate tile.",
	},
	check: ({ snapshot }) =>
		snapshot.elements.flatMap((h) => {
			const title =
				["div", "span"].includes(h.tag) &&
				["block", "flow-root"].includes(styleOf(h, "display")) &&
				h.children.length === 0 &&
				h.ownText.length >= 2 &&
				h.ownText.length <= 80 &&
				Number(styleOf(h, "font-weight")) >= 600 &&
				fontSizePx(h) >= 16
			if ((!isHeading(h) && !title) || !visible(snapshot, h)) return []
			const found = labelBefore(snapshot, h)
			if (!found) return []
			let box = found.label
			for (let i = 0; i < 3; i++) {
				const children = childrenOf(snapshot, box),
					only = children[0]
				if (styleOf(box, "display") === "contents") {
					box = children.at(-1) ?? box
					continue
				}
				const bg = parseColor(styleOf(box, "background-color"))
				const bare =
					(bg === null || bg.a === 0) &&
					["none", ""].includes(styleOf(box, "background-image")) &&
					parseShadow(styleOf(box, "box-shadow")).length === 0 &&
					length(styleOf(box, "border-top-width")) === 0
				if (
					children.length !== 1 ||
					!only ||
					!bare ||
					Math.abs(box.rect.width - only.rect.width) > 2 ||
					Math.abs(box.rect.height - only.rect.height) > 2
				)
					break
				box = only
			}
			const candidates = [box]
			const tile = candidates.find((t) => {
				const { width: w, height: hgt } = t.rect,
					bg = parseColor(styleOf(t, "background-color"))
				if (
					w < 32 ||
					w > 128 ||
					hgt < 32 ||
					hgt > 128 ||
					w / hgt < 0.7 ||
					w / hgt > 1.4 ||
					Math.max(...radii(t)) >= w / 2 ||
					!visible(snapshot, t) ||
					!nearAbove(t, h)
				)
					return false
				const framed =
					(bg !== null && bg.a >= 0.05) ||
					!["none", ""].includes(styleOf(t, "background-image")) ||
					length(styleOf(t, "border-top-width")) > 0 ||
					parseShadow(styleOf(t, "box-shadow")).some((l) => l.color.a > 0 && !l.inset)
				if (!framed) return false
				const emoji = (text: string): boolean => /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(text) && text.trim() !== ""
				return (
					emoji(t.ownText) ||
					[...descendants(snapshot, t)].some(
						(c) =>
							visible(snapshot, c) &&
							(["svg", "i", "img"].includes(c.tag) ||
								!["none", ""].includes(styleOf(c, "mask-image")) ||
								!["none", ""].includes(styleOf(c, "-webkit-mask-image")) ||
								emoji(c.text)) &&
							c.rect.width < w * 0.95,
					)
				)
			})
			return tile ? [{ element: h, message: "Framed icon tile stacked above heading", snippet: shortSnippet(h) }] : []
		}),
}
