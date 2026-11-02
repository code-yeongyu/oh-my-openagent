import { parseColor } from "../../../core/color"
import { fontSizePx, styleOf } from "../../../core/page"
import type { ElementSnapshot } from "../../../types"

const safeTags = new Set([
	"blockquote", "nav", "a", "input", "textarea", "select", "pre", "code", "span", "th", "td", "tr", "li", "label", "button",
	"hr", "html", "head", "body", "script", "style", "link", "meta", "title", "br", "img", "svg", "path", "circle", "rect",
	"line", "polyline", "polygon", "g", "defs", "use",
])

export function bareText(el: ElementSnapshot): boolean {
	if (!safeTags.has(el.tag)) return false
	const fill = parseColor(styleOf(el, "background-color"))
	return !(el.ownText.trim() && fontSizePx(el) >= 9 && ((fill?.a ?? 0) > 0.5 || styleOf(el, "background-image").includes("gradient")))
}
