const PROLOG_TAGS = ["!doctype", "html", "head"] as const

function skipBlankAndComments(html: string, from: number): number {
	let i = from
	for (;;) {
		while (i < html.length && /\s/.test(html.charAt(i))) i++
		const [open, close] = html.startsWith("<!--", i) ? ["<!--", "-->"] : html.startsWith("<?", i) ? ["<?", "?>"] : ["", ""]
		if (open === "") return i
		const end = html.indexOf(close, i + open.length)
		if (end === -1) return html.length
		i = end + close.length
	}
}

function tagEnd(html: string, from: number): number {
	let quote = ""
	for (let i = from; i < html.length; i++) {
		const c = html.charAt(i)
		if (quote !== "") {
			if (c === quote) quote = ""
		} else if (c === '"' || c === "'") quote = c
		else if (c === ">") return i + 1
	}
	return -1
}

function openingAt(html: string, at: number, name: string): boolean {
	if (html.charAt(at) !== "<" || html.slice(at + 1, at + 1 + name.length).toLowerCase() !== name) return false
	const next = html.charAt(at + 1 + name.length)
	return next === ">" || next === "/" || /\s/.test(next)
}

/**
 * Inserts `snippet` right after the document prolog (doctype, then the `<html>` and `<head>` openings, in that order,
 * with whitespace, comments and processing instructions such as `<?xml ...?>` between them), so it runs before any page script and never lands before the doctype,
 * inside a comment, inside an attribute value, or inside a later script. With no prolog it goes first.
 */
export function insertAfterProlog(html: string, snippet: string): string {
	let at = 0
	let next = 0
	for (const name of PROLOG_TAGS) {
		const start = skipBlankAndComments(html, next)
		if (!openingAt(html, start, name)) continue
		const end = tagEnd(html, start + 1 + name.length)
		if (end === -1) break
		at = end
		next = end
	}
	return `${html.slice(0, at)}${snippet}${html.slice(at)}`
}
