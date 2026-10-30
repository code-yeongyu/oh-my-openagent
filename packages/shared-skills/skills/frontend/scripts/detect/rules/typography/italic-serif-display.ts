import { descendants, fontSizePx, shortSnippet, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { visibleText } from "./support/text-context"
import { primaryFont } from "./support/font-family"

const serifNames = ["fraunces", "recoleta", "newsreader", "playfair display", "playfair", "cormorant", "cormorant garamond", "garamond", "eb garamond", "tiempos", "tiempos headline", "tiempos text", "lora", "vollkorn", "spectral", "source serif pro", "source serif 4", "source serif", "ibm plex serif", "merriweather", "libre caslon", "libre baskerville", "baskerville", "georgia", "times new roman", "times", "dm serif display", "dm serif text", "instrument serif", "gt sectra", "ogg", "canela", "freight display", "freight text"]

export const italicSerifDisplay: PageRule = {
	meta: {
		id: "italic-serif-display", name: "Italic serif display headline", category: "slop", severity: "warning", engine: "page",
		description: "An italic serif at hero scale repeats a common landing-page treatment.",
		fixHint: "Use roman type or a non-serif display face unless the brief calls for editorial typography.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap(element => {
		if (["h1", "h2"].includes(element.tag) === false || visibleText(snapshot, element) === false) return []
		const italic = [element, ...descendants(snapshot, element)].some(n => {
			const families = styleOf(n, "font-family").toLowerCase().split(",").map(f => f.trim().replace(/^['"]|['"]$/g, ""))
			const primary = primaryFont(styleOf(n, "font-family"), true)
			return visibleText(snapshot, n) && n.ownText.trim() !== "" && styleOf(n, "font-style") === "italic" &&
				fontSizePx(n) >= 48 && primary !== "" && (serifNames.includes(primary) || families.includes("serif"))
		})
		return italic ? [{ element, message: "Italic serif heading at 48px or larger", snippet: shortSnippet(element) }] : []
	}),
}
