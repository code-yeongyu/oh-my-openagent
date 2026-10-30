import { styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { brandDomain, canonicalFont, overusedFonts, primaryFont } from "./support/font-family"
import { cjkChar, letters, lineage } from "./support/text-context"

export const overusedFont: PageRule = {
	meta: {
		id: "overused-font", name: "Overused font", category: "slop", severity: "warning", engine: "page",
		description: "The page's dominant face comes from a frequently repeated set of interface fonts.",
		fixHint: "Choose a face suited to the project, or list the intentional choice in allowFonts.",
	},
	check: ({ snapshot, config }) => {
		const usage = new Map<string, { count: number; chars: number; latin: number }>()
		let total = 0
		let chars = 0
		let letterCount = 0
		let cjkCount = 0
		for (const e of snapshot.elements) {
			if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "dd", "blockquote", "figcaption", "a", "button", "label", "span"].includes(e.tag) === false ||
				e.ownText.trim() === "" || lineage(snapshot, e).some(n => /impeccable-(overlay|label|banner|tooltip)/.test(n.attributes["class"] ?? ""))) continue
			const font = canonicalFont(primaryFont(styleOf(e, "font-family")))
			if (font === "") continue
			const hasBox = lineage(snapshot, e).every(n => n.attributes["hidden"] === undefined &&
				styleOf(n, "display") !== "none" && ["hidden", "collapse"].includes(styleOf(n, "visibility")) === false &&
				styleOf(n, "content-visibility") !== "hidden")
			const weight = hasBox ? [...e.ownText].length : 0
			const alphabet = hasBox ? letters(e.ownText) : []
			const cjkLetters = alphabet.filter(cjkChar).length
			const value = usage.get(font) ?? { count: 0, chars: 0, latin: 0 }
			usage.set(font, { count: value.count + 1, chars: value.chars + weight, latin: value.latin + alphabet.length - cjkLetters })
			total++
			chars += weight
			letterCount += alphabet.length
			cjkCount += cjkLetters
		}
		const ranked = [...usage].sort((a, b) => b[1].count - a[1].count)
		const top = ranked[0]
		if (total < 20 || top === undefined || ranked[1]?.[1].count === top[1].count) return []
		const [font, value] = top
		if (overusedFonts.includes(font) === false || config.allowFonts?.some(f => canonicalFont(f) === font) ||
			brandDomain(font, snapshot.url) || (chars > 0 && value.chars / chars < 0.05) ||
			(cjkCount * 2 > letterCount && value.latin / letterCount < 0.05)) return []
		return [{ element: null, message: `Primary font: ${font} (${Math.round(value.count / total * 100)}% of text)`, snippet: font }]
	},
}
