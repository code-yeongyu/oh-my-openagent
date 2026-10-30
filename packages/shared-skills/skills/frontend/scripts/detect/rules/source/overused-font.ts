import type { SourceRule } from "../../rule"
import { lineCheck, sourceExtensions } from "./support/source-text"

const fonts = ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Arial", "Helvetica", "Fraunces", "Geist Sans", "Geist Mono", "Geist", "Mona Sans", "Plus Jakarta Sans", "Space Grotesk", "Recoleta", "Instrument Sans", "Instrument Serif"]

export const overusedFont: SourceRule = {
	meta: { id: "overused-font", name: "Overused font", category: "slop", severity: "warning", engine: "source", description: "A familiar default typeface appears in a font declaration or import.", fixHint: "Choose a typeface suited to the product, or allow the intentional family." },
	extensions: sourceExtensions,
	check: lineCheck([new RegExp(`font-family\\s*:\\s*['"]?(${fonts.join("|")})\\b`, "gi"), /fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi], ({ match, context }) => {
		const query = new URLSearchParams(match[0].slice(match[0].indexOf("?") + 1))
		const family = match[1] ?? query.getAll("family").flatMap((value) => value.split("|")).map((f) => f.split(":")[0] ?? "")
			.find((f) => fonts.some((font) => font.toLowerCase() === f.toLowerCase()) && !context.config.allowFonts?.some((allowed) => allowed.toLowerCase() === f.toLowerCase()))
		if (!family || context.config.allowFonts?.some((f) => f.toLowerCase() === family.toLowerCase())) return null
		return match[1] ? match[0] : `Google Fonts: ${family.toLowerCase()}`
	}),
}
