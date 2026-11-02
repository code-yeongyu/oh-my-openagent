export const overusedFonts = [
	"inter", "roboto", "open sans", "lato", "montserrat", "arial", "helvetica", "fraunces",
	"instrument sans", "instrument serif", "geist", "geist sans", "geist mono", "mona sans",
	"plus jakarta sans", "space grotesk", "recoleta",
]
const genericFonts = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "inherit", "initial", "unset", "revert"]
const platformFonts = ["system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "-apple-system", "blinkmacsystemfont", "segoe ui"]

export const normalizeFont = (value: string): string => value.trim().replace(/^['"]|['"]$/g, "").replace(/\+/g, " ").replace(/\s+/g, " ").toLowerCase()
export const canonicalFont = (value: string): string => {
	const normalized = normalizeFont(value)
	const key = normalized.replace(/[-_ ]/g, "")
	return overusedFonts.find(f => f.replace(/[-_ ]/g, "") === key) ?? normalized
}
export function primaryFont(stack: string, skipPlatform = false): string {
	if (stack.includes("var(")) return ""
	const families = stack.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []
	return families.map(normalizeFont).find(f =>
		f !== "" && genericFonts.includes(f) === false && (skipPlatform === false || platformFonts.includes(f) === false)) ?? ""
}

export function brandDomain(font: string, url: string): boolean {
	const host = URL.canParse(url) ? new URL(url).hostname.toLowerCase() : ""
	const domains = font === "roboto" ? ["google.com", "youtube.com", "android.com", "chromium.org", "chrome.com", "web.dev", "gstatic.com", "firebase.google.com"] :
		["geist", "geist sans", "geist mono"].includes(font) ? ["vercel.com", "nextjs.org", "v0.app"] :
			font === "mona sans" ? ["github.com", "githubnext.com"] : []
	return domains.some(d => host === d || host.endsWith(`.${d}`))
}
