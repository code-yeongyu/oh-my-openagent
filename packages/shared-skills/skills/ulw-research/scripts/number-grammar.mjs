// number-grammar.mjs - the one grouped-number grammar. A grouped number is a 1-3 digit leading
// group, then one or more 3-digit groups joined by ONE separator type, with no digit right after the
// last group, then an optional decimal part. "12,3451" is therefore not "12,345" plus "1". A period
// groups only when the reading is unambiguous: two or more period groups ("1.234.567") or one group
// before a decimal comma ("1.234,5"); a lone "1.234" is a decimal, as numerals.mjs reads it. Shared by
// numerals.mjs (comma grouping), the conversion probe (every separator), the value-mode unit check,
// and the converted-half display check. Pure; no imports.

/** Separators a thousands group may use: comma, period, space, NBSP, narrow NBSP, thin space, figure space. */
export const GROUP_SEPARATORS = Object.freeze([",", ".", " ", "\u00A0", "\u202F", "\u2009", "\u2007"])

const literal = (sep) => (sep === "." ? "\\." : sep === " " ? " " : sep === "," ? "," : `\\u${sep.charCodeAt(0).toString(16).padStart(4, "0")}`)
const decimalAfter = (sep) => (sep === "," ? "\\." : sep === "." ? "," : "[.,]")

/** Regex source of one grouped number using any of `separators` (one type per number); no flags needed. */
export function groupedNumberSource(separators = GROUP_SEPARATORS) {
	const one = (sep) => sep === "."
		? "\\d{1,3}(?:(?:\\.\\d{3}(?!\\d)){2,}(?:,\\d+)?|\\.\\d{3}(?!\\d),\\d+)"
		: `\\d{1,3}(?:${literal(sep)}\\d{3}(?!\\d))+(?:${decimalAfter(sep)}\\d+)?`
	return `(?<!\\d)(?:${separators.map(one).join("|")})`
}

/** A grouped number or a plain one ("4.22", "12,3451" read as 12.3451), as regex source. */
export const NUMBER_SOURCE = `(?:${groupedNumberSource()}|(?<!\\d)\\d+(?:[.,]\\d+)?)`

const WHOLE = new Map(GROUP_SEPARATORS.map((sep) => [sep, new RegExp(`^${groupedNumberSource([sep])}$`)]))

/** The plain decimal a number token spells: group separators dropped, a decimal comma read as a point. */
export function plainDecimal(token) {
	const sep = GROUP_SEPARATORS.find((candidate) => WHOLE.get(candidate).test(token))
	const ungrouped = sep === undefined ? token : token.split(sep).join("")
	return ungrouped.replace(",", ".")
}
