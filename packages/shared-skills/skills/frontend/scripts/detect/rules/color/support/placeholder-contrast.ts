import { blend, contrastRatio, parseColor } from "../../../core/color"
import { ancestors, fontSizePx, styleOf } from "../../../core/page"
import type { PageHit } from "../../../rule"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { textPainted } from "./painted-text"
import { textBackgrounds } from "./text-colors"

export function placeholderContrast(snapshot: PageSnapshot, el: ElementSnapshot): readonly PageHit[] {
	const text = (el.attributes["placeholder"] ?? "").trim()
	if (!["input", "textarea"].includes(el.tag) || !el.placeholder || !text || !textPainted(snapshot, el)) return []
	if ([el, ...ancestors(snapshot, el)].some((node) => node.attributes["disabled"] !== undefined || node.attributes["aria-disabled"] === "true")) return []
	if (el.tag === "input" && ["hidden", "checkbox", "radio", "file", "submit", "button", "image", "reset", "range", "color"].includes((el.attributes["type"] ?? "text").toLowerCase())) return []
	const ink = parseColor(el.placeholder.style["color"] ?? "")
	if (!ink || ink.a <= 0.02) return []
	const backgrounds = textBackgrounds(snapshot, el)
	if (backgrounds.length === 0) return []
	const size = fontSizePx(el)
	if (size <= 0) return []
	const words = (styleOf(el, "font-family").split(",")[0] ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/)
	const namedBold = words.some((word) => ["bold", "semibold", "demibold", "extrabold", "ultrabold", "heavy", "black"].includes(word))
	const weight = namedBold ? Math.max(700, Number.parseFloat(styleOf(el, "font-weight")) || 400) : Number.parseFloat(styleOf(el, "font-weight"))
	const threshold = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5
	const ratio = Math.min(...backgrounds.map((background) => contrastRatio(blend(ink, background), background)))
	return ratio < threshold ? [{ element: el, message: `Placeholder contrast ${ratio.toFixed(2)}:1; needs ${threshold}:1`, snippet: text }] : []
}
