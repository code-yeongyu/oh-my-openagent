import { parseColor, type Rgba } from "../../../core/color"
import { px, styleOf } from "../../../core/page"
import { parseShadow } from "../../../core/shadow"
import { cssBlocks } from "../../../core/source"
import type { PageSnapshot } from "../../../types"
import { matchesSelector } from "../../decoration/support/css-candidates"
import { colorDistance, gradientStops } from "./gradients"
import { paletteVisible } from "./palette-roles"

const colors = ["#7c3aed", "#8b5cf6", "#a855f7", "#9333ea", "#7e22ce", "#6d28d9", "#6366f1", "#764ba2", "#667eea"]
	.map(parseColor).filter((color) => color !== null)
const stock = (color: Rgba | null): boolean => color !== null && color.a > 0.1 && colors.some((c) => colorDistance(c, color) <= 8)

export function stockAccent(snapshot: PageSnapshot): boolean {
	const trigger = /(?:^|;)\s*color\s*:[^;]*#(?:7c3aed|8b5cf6|a855f7|9333ea|7e22ce|6d28d9)\b|gradient[^;]*#(?:7c3aed|8b5cf6|a855f7|764ba2|667eea)\b/i
	const declared = snapshot.elements.some((el) => trigger.test(el.attributes["style"] ?? "") && paletteVisible(snapshot, el))
		|| snapshot.cssText.some((css) => cssBlocks(css).some((block) =>
		trigger.test(block.body) && block.selector.split(",").some((selector) =>
			snapshot.elements.some((el) => matchesSelector(snapshot, el, selector.trim()) && paletteVisible(snapshot, el)))))
	if (!declared) return false
	return snapshot.elements.some((el) => {
		if (!paletteVisible(snapshot, el)) return false
		if (el.ownText.trim() && stock(parseColor(styleOf(el, "color")))) return true
		if (stock(parseColor(styleOf(el, "background-color"))) || gradientStops(styleOf(el, "background-image")).some((s) => stock(s.color))) return true
		for (const side of ["top", "right", "bottom", "left"]) {
			if ((px(styleOf(el, `border-${side}-width`)) ?? 0) > 0 && !["none", "hidden"].includes(styleOf(el, `border-${side}-style`)) && stock(parseColor(styleOf(el, `border-${side}-color`)))) return true
		}
		if ((px(styleOf(el, "outline-width")) ?? 0) > 0 && !["", "none"].includes(styleOf(el, "outline-style")) && stock(parseColor(styleOf(el, "outline-color")))) return true
		return parseShadow(styleOf(el, "box-shadow")).some((s) => stock(s.color) && [s.x, s.y, s.blur, s.spread].some((n) => n !== 0))
	})
}
