// Row tables for the Sources numeral classes (lead order, review round 5 #11302): every form of a
// class with the class the Sources predicate must give each digit run in it. A string expectation
// applies to every digit run of the input; an array lists them in order. Consumed by
// sources-citation.test.ts. Korean text is \u escaped.

export type NumeralKind = "numeral" | "name" | "date" | "citation-field"
export type ClassRow = { input: string; expected: NumeralKind | NumeralKind[] }

// Class 1: numeral tokenization vs glued letters. Every unit, multiplier, percent, and currency
// token of units.mjs (tokens and aliases) and of the numerals.mjs UNIT pattern, written after the
// number: glued, spaced, glued behind a Hangul word, glued behind a Latin word, with a Korean
// particle, and behind a Hangul word with a particle.
const LATIN_UNITS = [
	"mm", "millimeter", "millimeters", "millimetre", "cm", "centimeter", "m", "meter", "meters", "metre", "km", "kilometer", "kilometers",
	"g", "gram", "grams", "kg", "kilogram", "kilograms", "t", "ton", "tons", "tonne", "tonnes",
	"ms", "millisecond", "milliseconds", "s", "sec", "secs", "second", "seconds", "min", "mins", "minute", "minutes", "h", "hr", "hrs", "hour", "hours",
	"day", "days", "week", "weeks", "month", "months", "mo", "year", "years", "yr", "yrs",
	"B", "byte", "bytes", "KB", "MB", "GB", "TB", "kb", "mb", "gb", "tb", "C", "F", "celsius", "fahrenheit",
	"percent", "pct", "permille", "pp", "bp", "bps",
	"x", "times", "k", "K", "thousand", "M", "mn", "million", "b", "bn", "billion", "T", "trillion",
	"person", "persons", "people", "users", "employees", "engineers", "tokens", "requests", "stars", "downloads", "customers", "case", "cases",
	"KRW", "won", "USD", "usd", "dollar", "dollars", "EUR", "eur", "euro", "euros", "JPY", "yen", "GBP", "pound", "pounds",
]
const SYMBOL_UNITS = ["%", "%p", "%pt", "\u2030", "\u00D7", "\u00B0C", "\u00B0F", "\u2103", "\u2109", "$", "\u20AC", "\u00A3", "\u00A5", "\u20A9"]
const HANGUL_UNITS = [
	"\uBC00\uB9AC\uBBF8\uD130", "\uC13C\uD2F0\uBBF8\uD130", "\uBBF8\uD130", "\uD0AC\uB85C\uBBF8\uD130", "\uADF8\uB7A8", "\uD0AC\uB85C\uADF8\uB7A8", "\uD1A4", "\uBC00\uB9AC\uCD08", "\uCD08", "\uBD84", "\uC2DC\uAC04", "\uC77C", "\uC8FC", "\uAC1C\uC6D4", "\uB144",
	"\uBC14\uC774\uD2B8", "\uD0AC\uB85C\uBC14\uC774\uD2B8", "\uBA54\uAC00\uBC14\uC774\uD2B8", "\uAE30\uAC00\uBC14\uC774\uD2B8", "\uD14C\uB77C\uBC14\uC774\uD2B8",
	"\uD37C\uC13C\uD2B8", "\uD504\uB85C", "\uD37C\uBC00", "\uD37C\uC13C\uD2B8\uD3EC\uC778\uD2B8", "\uBC30", "\uCC9C", "\uB9CC", "\uBC31\uB9CC", "\uC5B5", "\uC2ED\uC5B5", "\uC870",
	"\uBA85", "\uAC74", "\uAC1C", "\uD68C", "\uBC88", "\uC6D0", "\uCC9C\uC6D0", "\uB9CC\uC6D0", "\uC5B5\uC6D0", "\uC870\uC6D0", "\uB2EC\uB7EC", "\uC720\uB85C", "\uC5D4", "\uD30C\uC6B4\uB4DC",
]
const KO_WORD = "\uB9E4\uCD9C"
const LATIN_WORD = "rate"

const unitRows = (unit: string, kind: "latin" | "symbol" | "hangul"): ClassRow[] => {
	const particle = kind === "hangul" ? "\uC774" : "\uB85C"
	return [
		{ input: `5${unit}`, expected: "numeral" },
		{ input: `5 ${unit}`, expected: "numeral" },
		{ input: `${KO_WORD}5${unit}`, expected: "numeral" },
		// Latin letters on both sides of a digit run make an identifier ("W3C"); a symbol or Hangul unit keeps it a measure.
		{ input: `${LATIN_WORD}5${unit}`, expected: kind === "latin" ? "name" : "numeral" },
		{ input: `5${unit}${particle}`, expected: "numeral" },
		{ input: `${KO_WORD}5${unit}${particle}`, expected: "numeral" },
	]
}

// Written before the number: currency symbols and codes, and a standalone multiplier x.
const PREFIXES = ["$", "US$", "\u20AC", "\u00A3", "\u00A5", "\u20A9", "USD", "KRW", "EUR", "JPY", "GBP"]
const prefixRows = (prefix: string): ClassRow[] => [
	{ input: `${prefix}5`, expected: "numeral" },
	{ input: `${prefix}5.5`, expected: "numeral" },
	{ input: `${KO_WORD}${prefix}5`, expected: "numeral" },
	{ input: `${prefix}5bn`, expected: "numeral" },
]

export const GLUED_LETTER_ROWS: ClassRow[] = [
	...LATIN_UNITS.flatMap((unit) => unitRows(unit, "latin")),
	...SYMBOL_UNITS.flatMap((unit) => unitRows(unit, "symbol")),
	...HANGUL_UNITS.flatMap((unit) => unitRows(unit, "hangul")),
	...PREFIXES.flatMap(prefixRows),
	// Multipliers on the left and on the right, with decimals.
	{ input: "x3", expected: "numeral" },
	{ input: "x1.5 faster", expected: "numeral" },
	{ input: "(x3)", expected: "numeral" },
	{ input: "\uC18D\uB3C4x3", expected: "numeral" },
	{ input: "\u00D73", expected: "numeral" },
	{ input: "3.5x", expected: "numeral" },
	{ input: "1.2bn", expected: "numeral" },
	{ input: "5.4T", expected: "numeral" },
	{ input: "3.5k", expected: "numeral" },
	{ input: "1M+", expected: "numeral" },
	{ input: "2.5\uBC30", expected: "numeral" },
	{ input: "1,200\uBA85", expected: "numeral" },
	{ input: "3\uC5B5 2,000\uB9CC\uC6D0", expected: "numeral" },
	// Glued letters that are not a unit, multiplier, percent, or currency: a name.
	{ input: "abc123", expected: "name" },
	{ input: "W3C", expected: "name" },
	{ input: "eb2b", expected: "name" },
	{ input: "a75f4d93ef", expected: "name" },
	{ input: "424B4", expected: "name" },
	{ input: "1H25", expected: "name" },
	{ input: "3D", expected: "name" },
	{ input: "21st", expected: "name" },
	{ input: "KOSPI200", expected: "name" },
	{ input: "Base44", expected: "name" },
	{ input: "H100", expected: "name" },
	{ input: "mp3", expected: "name" },
	{ input: "[w1:x02]", expected: ["name", "name"] },
	{ input: "x02", expected: "name" },
	{ input: "rate5M", expected: "name" },
	{ input: "\uCF54\uB4DCabc123", expected: "name" },
	// Korean ordinals are names: the prefix je, the suffix jjae, and the counter cha.
	{ input: "\uC81C3\uD68C", expected: "name" },
	{ input: "\uC81C3\uC790", expected: "name" },
	{ input: "\uC81C2\uCC28", expected: "name" },
	{ input: "3\uBC88\uC9F8", expected: "name" },
	{ input: "2\uCC28 \uBCF4\uB3C4", expected: "name" },
	// A word glued in front of a measure keeps it a numeral (the round-4 receipt rows).
	{ input: "\uB9E4\uCD9C40% \uC99D\uAC00.", expected: "numeral" },
	{ input: "\uC804\uB144\uB300\uBE4430%", expected: "numeral" },
	{ input: "\uC57D300\uBA85", expected: "numeral" },
	{ input: "Churn rate40%", expected: "numeral" },
	{ input: "x3 faster.", expected: "numeral" },
	{ input: "Grew 5mn users.", expected: "numeral" },
	{ input: "Up 40pct.", expected: "numeral" },
	{ input: "5yrs of data.", expected: "numeral" },
]

// Class 2: date, version, and name shapes: every slashed, dotted, and dashed form.
export const SHAPE_ROWS: ClassRow[] = [
	// Month/day, day/month/year, and full dates.
	{ input: "10/26", expected: "date" },
	{ input: "1/31", expected: "date" },
	{ input: "12/1", expected: "date" },
	{ input: "(released 10/26)", expected: "date" },
	{ input: "10/26 \uACF5\uAC1C", expected: "date" },
	{ input: "26/10/2026", expected: "date" },
	{ input: "10/26/2026", expected: "date" },
	{ input: "26.10.2026", expected: "date" },
	{ input: "26-10-2026", expected: "date" },
	{ input: "2026-10-26", expected: "date" },
	{ input: "2026/10/26", expected: "date" },
	{ input: "2026.10.26", expected: "date" },
	{ input: "2026.10.26.", expected: "date" },
	{ input: "2026. 10. 26.", expected: "date" },
	{ input: "2026-10", expected: "date" },
	{ input: "2026.10", expected: "date" },
	{ input: "26.10.26", expected: "date" },
	{ input: "Oct 26", expected: "date" },
	{ input: "26 Oct", expected: "date" },
	{ input: "October 26, 2026", expected: "date" },
	{ input: "26 October 2026", expected: "date" },
	{ input: "2026\uB144 10\uC6D4 26\uC77C", expected: "date" },
	{ input: "10\uC6D4 26\uC77C", expected: "date" },
	{ input: "2026", expected: "date" },
	{ input: "2026\uB144", expected: "date" },
	{ input: "2025\uB144 3\uBD84\uAE30", expected: "date" },
	{ input: "3\uBD84\uAE30", expected: "date" },
	{ input: "2026\uB144 1\uBD84\uAE30", expected: "date" },
		// Year ranges.
	{ input: "2019-2023", expected: "date" },
	{ input: "2019~2023", expected: "date" },
	{ input: "2019\u20132023", expected: "date" },
	{ input: "2019 \u2013 2023", expected: "date" },
	{ input: "2025\u20132026\uB144", expected: "date" },
	{ input: "2019~2023\uB144", expected: "date" },
	// Not a date: a slashed pair outside month/day, and a day count.
	{ input: "13/45", expected: ["numeral", "numeral"] },
	{ input: "30 days", expected: "numeral" },
	{ input: "30\uC77C\uAC04", expected: "numeral" },
	// Versions and decimals: a dotted run with a segment that is not three digits is a version name;
	// one dot is a decimal; three-digit period groups are a European grouping.
	{ input: "1.2", expected: "numeral" },
	{ input: "Llama 3.1", expected: "numeral" },
	{ input: "v1.2", expected: "name" },
	{ input: "1.2.3", expected: "name" },
	{ input: "0.30.14", expected: "name" },
	{ input: "v2.3.1", expected: "name" },
	{ input: "(3.1.1)", expected: "name" },
	{ input: "1.234.567", expected: "numeral" },
	{ input: "1.234.567\uBA85", expected: "numeral" },
	{ input: "1.234,5", expected: "numeral" },
	{ input: "1,234.5", expected: "numeral" },
	{ input: "1,234,567", expected: "numeral" },
	{ input: "1.234", expected: "numeral" },
	// Codes: a filing code whose letter is a multiplier stays a numeral; other codes are names.
	{ input: "10-K", expected: "numeral" },
	{ input: "8-K", expected: "numeral" },
	{ input: "10-Q", expected: "name" },
	{ input: "S-1", expected: "name" },
	{ input: "#123", expected: "name" },
	{ input: "#6674\u2013#7906", expected: ["name", "name"] },
	{ input: "GPT-4", expected: "name" },
	{ input: "H.15", expected: "name" },
	{ input: "Q3", expected: "name" },
	{ input: "FY27", expected: "name" },
	{ input: "Q3-2024", expected: ["name", "date"] },
	{ input: "H1 2026", expected: ["name", "date"] },
	{ input: "2024-Q3-F1", expected: ["date", "name", "name"] },
	{ input: "DGS10/DGS30", expected: ["name", "name"] },
	// Citation fields: markers, identifiers, and containers.
	{ input: "pp. 12-15", expected: "citation-field" },
	{ input: "p. 7", expected: "citation-field" },
	{ input: "Vol. 2024/1", expected: "citation-field" },
	{ input: "No. 3", expected: "citation-field" },
	{ input: "3rd edition", expected: "citation-field" },
	{ input: "45-52\uCABD", expected: "citation-field" },
	{ input: "3\uAD8C 2\uD638", expected: "citation-field" },
	{ input: "[S4]", expected: "citation-field" },
	{ input: "DOI 10.1145/1571941.1572114", expected: "citation-field" },
	{ input: "arXiv 2402.17753", expected: "citation-field" },
	{ input: "ISBN 978-0-306-40615-7", expected: "citation-field" },
	{ input: "https://example.com/2024/10/report-42", expected: "citation-field" },
	{ input: "\"Sales fell 3.5% in Q2\"", expected: "citation-field" },
	{ input: "\u300C\uC218\uCD9C 12% \uC99D\uAC00\u300D", expected: "citation-field" },
]
