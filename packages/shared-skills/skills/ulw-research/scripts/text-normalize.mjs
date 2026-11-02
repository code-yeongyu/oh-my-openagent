// text-normalize.mjs - text normalization and raw-offset matching for fidelity checks.
//
// normalizeText applies NFC, maps curly and CJK quote glyphs to straight quotes, collapses
// whitespace runs to one space, and trims. findNormalized matches a needle against the
// normalized haystack and returns offsets into the RAW haystack through an offset map built
// during normalization. Plain Node ESM, no dependencies.

const DOUBLE_QUOTES = new Set([
	"\u201C", "\u201D", "\u201E", "\u201F", "\u00AB", "\u00BB", "\u300C", "\u300D", "\u300E", "\u300F",
	"\u301D", "\u301E", "\u301F", "\uFF02", "\u2033",
])
const SINGLE_QUOTES = new Set(["\u2018", "\u2019", "\u201A", "\u201B", "\u2039", "\u203A", "\uFF07", "\u2032"])
// Combining marks and conjoining Hangul medial/final jamo attach to the preceding code point,
// so a decomposed syllable is normalized as one unit.
const JOINS_PREVIOUS = /^[\p{M}\u1160-\u11FF\uD7B0-\uD7FF]$/u
const WHITESPACE = /^\s+$/u
const TOKEN_SEPARATOR = /[^\p{L}\p{N}\p{M}]+/u

function mapQuote(ch) {
	if (DOUBLE_QUOTES.has(ch)) return '"'
	if (SINGLE_QUOTES.has(ch)) return "'"
	return ch
}

function clusters(raw) {
	const out = []
	let at = 0
	for (const ch of raw) {
		const last = out[out.length - 1]
		if (last && JOINS_PREVIOUS.test(ch)) last[1] += ch.length
		else out.push([at, at + ch.length])
		at += ch.length
	}
	return out
}

// Returns { text, starts, ends }: text[k] came from raw.slice(starts[k], ends[k]).
function normalizeWithMap(raw) {
	const source = String(raw ?? "")
	let text = ""
	const starts = []
	const ends = []
	for (const [start, end] of clusters(source)) {
		const piece = Array.from(source.slice(start, end).normalize("NFC"), mapQuote).join("")
		if (WHITESPACE.test(piece)) {
			if (text !== "" && !text.endsWith(" ")) {
				text += " "
				starts.push(start)
				ends.push(end)
			}
			continue
		}
		for (let k = 0; k < piece.length; k++) {
			starts.push(start)
			ends.push(end)
		}
		text += piece
	}
	if (text.endsWith(" ")) {
		text = text.slice(0, -1)
		starts.pop()
		ends.pop()
	}
	return { text, starts, ends }
}

export function normalizeText(s) {
	return normalizeWithMap(s).text
}

export function tokenize(s) {
	return normalizeText(s).split(TOKEN_SEPARATOR).filter((token) => token !== "")
}

export function findNormalized(hay, needle) {
	const target = normalizeText(needle)
	if (target === "") return null
	const map = normalizeWithMap(hay)
	const at = map.text.indexOf(target)
	if (at === -1) return null
	return { start: map.starts[at], end: map.ends[at + target.length - 1] }
}
