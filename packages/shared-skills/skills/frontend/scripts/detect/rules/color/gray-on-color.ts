import { luminance, parseColor, toHsl, type Rgba } from "../../core/color"
import { shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { oklch, spread } from "./support/gradients"
import { clipsText, textBackgrounds, textInk } from "./support/text-colors"
import { bareText } from "./support/color-path"
import { textPainted } from "./support/painted-text"

function colored(bg: Rgba): boolean {
	const lum = luminance(bg)
	const scale = lum >= 0.01 ? 1 : Math.sqrt(0.01 / Math.max(lum, 0.0001))
	const perceptual = oklch(bg)
	return spread(bg) > 40 * scale && (perceptual.l < 0.9 || perceptual.c >= 0.09)
}

export const grayOnColor: PageRule = {
	meta: {
		id: "gray-on-color", name: "Gray text on colored background", category: "quality", severity: "warning", engine: "page",
		description: "Mid-gray ink loses clarity on a chromatic surface.",
		fixHint: "Use a dark shade of the surface hue or a contrasting near-white ink.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		if (!textPainted(snapshot, el) || bareText(el) || clipsText(el)) return []
		const color = parseColor(styleOf(el, "color"))
		if (!color) return []
		const hsl = toHsl(color)
		const gray = hsl.s < 0.2 && hsl.l > 0.3 && hsl.l < 0.85
		const tokens = (el.attributes["class"] ?? "").split(/\s+/)
		const grayClass = tokens.some((t) => /^text-(gray|slate|zinc|neutral|stone)-[1-6]00(?:\/\d+)?$/.test(t))
		const bgClass = tokens.some((t) => /^bg-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-([2-9]00|950)(?:\/\d+)?$/.test(t))
		const classHit = grayClass && bgClass && hsl.l < 0.85 && spread(color) <= 50
		const backgrounds = textBackgrounds(snapshot, el)
		const computedHit = textInk(snapshot, el) !== null && gray && backgrounds.length > 0 && backgrounds.every(colored)
		if (!classHit && !computedHit) return []
		const hit = { element: el, message: "Gray ink on a colored surface", snippet: shortSnippet(el) }
		return classHit && computedHit ? [hit, hit] : [hit]
	}),
}
