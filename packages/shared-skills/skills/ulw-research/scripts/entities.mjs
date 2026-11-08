// entities.mjs - HTML character reference decoding for html-lite.mjs.
//
// Supports a fixed set of named entities (NAMED_ENTITIES) plus decimal and hex numeric references.
// Unknown or malformed references stay verbatim. Single indexOf scan; plain Node ESM, no dependencies.

// Beyond the common set, every named reference whose character a number reader treats specially is
// listed (signs, dashes, the space separators that group digits, and Markdown punctuation), so the
// conversion probe reads `&minus;5` and `1&thinsp;234` as a converter does.
const NAMED_ENTITIES = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", mdash: "\u2014", ndash: "\u2013",
	hellip: "\u2026", copy: "\u00a9", reg: "\u00ae", times: "\u00d7", middot: "\u00b7",
	minus: "\u2212", hyphen: "\u2010", dash: "\u2010", NonBreakingSpace: "\u00a0", thinsp: "\u2009",
	ThinSpace: "\u2009", numsp: "\u2007", puncsp: "\u2008", hairsp: "\u200a", VeryThinSpace: "\u200a",
	ensp: "\u2002", emsp: "\u2003", emsp13: "\u2004", emsp14: "\u2005", MediumSpace: "\u205f",
	comma: ",", period: ".", plus: "+", lowbar: "_", UnderBar: "_", ast: "*", midast: "*", grave: "`",
	DiacriticalGrave: "`", lpar: "(", rpar: ")", lsqb: "[", lbrack: "[", rsqb: "]", rbrack: "]",
}

/** One reference body (between `&` and `;`), or null when unsupported. */
export function decodeOne(body) {
	if (Object.hasOwn(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body]
	if (body[0] !== "#") return null
	const hex = body[1] === "x" || body[1] === "X"
	const digits = body.slice(hex ? 2 : 1)
	if (!(hex ? /^[0-9a-fA-F]{1,6}$/ : /^[0-9]{1,7}$/).test(digits)) return null
	const cp = Number.parseInt(digits, hex ? 16 : 10)
	return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : "\ufffd"
}

/** Decode the supported named entities plus decimal/hex numeric references; unknown ones stay verbatim. */
export function decodeEntities(text) {
	const source = String(text)
	let out = ""
	let last = 0
	let at = source.indexOf("&")
	while (at !== -1) {
		const semi = source.indexOf(";", at + 1)
		const decoded = semi !== -1 && semi - at <= 32 ? decodeOne(source.slice(at + 1, semi)) : null
		if (decoded !== null) {
			out += source.slice(last, at) + decoded
			last = semi + 1
			at = source.indexOf("&", last)
		} else {
			at = source.indexOf("&", at + 1)
		}
	}
	return out + source.slice(last)
}
