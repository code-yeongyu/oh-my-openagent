import { parseShadow, type ShadowLayer } from "../../../core/shadow"
import { authoredColor } from "./source-color"

export function sourceShadows(value: string, status = false): readonly ShadowLayer[] {
	const filled = value.replace(/var\([^)]*\)|(?:rgba?|hsla?|hwb|color|oklab|oklch)\([^()]*\)|#[0-9a-f]{3,8}\b|\b[a-z]+\b(?!\s*\()/gi, (token) => {
		if (token.toLowerCase() === "inset" || token.toLowerCase() === "px") return token
		if (token.startsWith("var(")) {
			const colored = /(?:^|-)(?:accent|kinpaku|patina|gold|red|orange|amber|yellow|lime|green|emerald|teal|cyan|blue|indigo|violet|purple|magenta|pink|rose|coral|aqua|mint|burgundy|crimson|scarlet)(?:-|[);])/i.test(token) || (status && /danger|error|warning|success|broken/.test(token))
			return colored ? "#d0342c" : "#000"
		}
		const c = authoredColor(token)
		return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})` : token
	})
	return parseShadow(filled)
}
