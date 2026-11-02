// units.mjs - unit table: normalization, dimensions, exact conversion factors, Korean readings.
//
// normalizeUnit maps a raw unit (any spacing or spelling variant) to one canonical token. Each token
// has a dimension, an exact factor to the dimension's base unit (base = value * factor + offset), and
// the final-sound class of its Korean reading for the particle rule: "open" (no final consonant),
// "l" (final rieul), or "closed". Currency is its own dimension per currency, so no exchange rate is
// ever implied. Data units are decimal (1 KB = 1000 B). Plain Node ESM, sibling imports only.

import { div, fromDecimal, sub } from "./rational.mjs"

/** [token, dimension, factor, reading, aliases, offset?]; the Korean reading is noted per row. */
const TABLE = [
	["mm", "length", "0.001", "open", ["millimeter", "millimeters", "millimetre", "millimetres", "\uBC00\uB9AC\uBBF8\uD130"]], // millimiteo
	["cm", "length", "0.01", "open", ["centimeter", "centimeters", "centimetre", "centimetres", "\uC13C\uD2F0\uBBF8\uD130"]], // sentimiteo
	["m", "length", "1", "open", ["meter", "meters", "metre", "metres", "\uBBF8\uD130"]], // miteo
	["km", "length", "1000", "open", ["kilometer", "kilometers", "kilometre", "kilometres", "\uD0AC\uB85C\uBBF8\uD130"]], // killomiteo
	["g", "mass", "1", "closed", ["gram", "grams", "\uADF8\uB7A8"]], // geuraem
	["kg", "mass", "1000", "closed", ["kilogram", "kilograms", "\uD0AC\uB85C\uADF8\uB7A8"]], // killogeuraem
	["t", "mass", "1000000", "closed", ["ton", "tons", "tonne", "tonnes", "\uD1A4"]], // ton
	["ms", "time", "0.001", "open", ["millisecond", "milliseconds", "\uBC00\uB9AC\uCD08"]], // millicho
	["s", "time", "1", "open", ["sec", "secs", "second", "seconds", "\uCD08"]], // cho
	["min", "time", "60", "closed", ["mins", "minute", "minutes", "\uBD84"]], // bun
	["h", "time", "3600", "closed", ["hr", "hrs", "hour", "hours", "\uC2DC\uAC04"]], // sigan
	// Months and years are a calendar dimension of their own (a year is no fixed number of seconds).
	["mo", "calendar", "1", "l", []], // gaewol
	["yr", "calendar", "12", "closed", ["yrs"]], // nyeon
	["B", "data", "1", "open", ["byte", "bytes", "\uBC14\uC774\uD2B8"]], // baiteu
	["KB", "data", "1000", "open", ["\uD0AC\uB85C\uBC14\uC774\uD2B8"]],
	["MB", "data", "1000000", "open", ["\uBA54\uAC00\uBC14\uC774\uD2B8"]],
	["GB", "data", "1000000000", "open", ["\uAE30\uAC00\uBC14\uC774\uD2B8"]],
	["TB", "data", "1000000000000", "open", ["\uD14C\uB77C\uBC14\uC774\uD2B8"]],
	["C", "temperature", "1", "open", ["\u00B0C", "\u2103", "celsius", "\uC12D\uC528"], "0"], // do
	["F", "temperature", "5/9", "open", ["\u00B0F", "\u2109", "fahrenheit", "\uD654\uC528"], "-160/9"], // do
	["%", "percent", "1", "open", ["percent", "pct", "\uD37C\uC13C\uD2B8", "\uD504\uB85C"]], // peosenteu
	["\u2030", "percent", "0.1", "l", ["permille", "\uD37C\uBC00"]], // peomil
	["%p", "percentage-point", "1", "open", ["pp", "%pt", "percentage point", "percentage points", "percent point", "percent points", "% point", "% points", "\uD37C\uC13C\uD2B8\uD3EC\uC778\uD2B8", "%\uD3EC\uC778\uD2B8"]],
	["x", "multiple", "1", "open", ["\u00D7", "times", "\uBC30"]], // bae
	["e3", "scale", "1000", "closed", ["k", "thousand", "\uCC9C"]], // cheon
	["e4", "scale", "10000", "closed", ["\uB9CC"]], // man
	["e6", "scale", "1000000", "closed", ["M", "mn", "million", "\uBC31\uB9CC"]], // baengman
	["e8", "scale", "100000000", "closed", ["\uC5B5"]], // eok
	["e9", "scale", "1000000000", "closed", ["bn", "billion", "\uC2ED\uC5B5"]], // sibeok
	["e12", "scale", "1000000000000", "open", ["trillion", "\uC870"]], // jo
	["person", "count:person", "1", "closed", ["persons", "people", "\uBA85"]], // myeong
	["case", "count:case", "1", "closed", ["cases", "\uAC74"]], // geon
	["KRW", "currency:KRW", "1", "closed", ["\uC6D0", "\u20A9", "won"]], // won
	["KRW-e3", "currency:KRW", "1000", "closed", ["\uCC9C\uC6D0"]],
	["KRW-e4", "currency:KRW", "10000", "closed", ["\uB9CC\uC6D0"]],
	["KRW-e8", "currency:KRW", "100000000", "closed", ["\uC5B5\uC6D0"]],
	["KRW-e12", "currency:KRW", "1000000000000", "closed", ["\uC870\uC6D0"]],
	["USD", "currency:USD", "1", "open", ["$", "US$", "dollar", "dollars", "\uB2EC\uB7EC"]], // dalleo
	["EUR", "currency:EUR", "1", "open", ["\u20AC", "euro", "euros", "\uC720\uB85C"]], // yuro
	["JPY", "currency:JPY", "1", "closed", ["\u00A5", "yen", "\uC5D4"]], // en
	["GBP", "currency:GBP", "1", "open", ["\u00A3", "pound", "pounds", "\uD30C\uC6B4\uB4DC"]], // paundeu
]

const parse = (text) => (text.includes("/") ? div(fromDecimal(text.split("/")[0]), fromDecimal(text.split("/")[1])) : fromDecimal(text))
const squash = (raw) => raw.replace(/\s+/g, "")

const ENTRIES = new Map()
/** Exact-case keys: every token and alias with whitespace removed. */
const EXACT = new Map()
/** Case-insensitive keys: multi-letter ASCII aliases only, so m/M and B/b never collide. */
const WORD = new Map()
/** Aliases written with their own spacing ("percentage points"), by lower-case text. */
const SPACED = new Map()
for (const [token, dimension, factor, reading, aliases, offset] of TABLE) {
	const entry = Object.freeze({ token, dimension, factor: parse(factor), offset: parse(offset ?? "0"), reading })
	ENTRIES.set(token, entry)
	for (const alias of [token, ...aliases]) {
		const key = squash(alias)
		EXACT.set(key, entry)
		if (alias !== token && key.length > 2 && /^[a-z]+$/.test(key) && !WORD.has(key.toLowerCase())) WORD.set(key.toLowerCase(), entry)
		if (/\s/.test(alias)) SPACED.set(alias.toLowerCase(), entry)
	}
}

function entryOf(raw) {
	if (typeof raw !== "string") return null
	const key = squash(raw)
	if (!key) return null
	return EXACT.get(key) ?? WORD.get(key.toLowerCase()) ?? null
}

/** Canonical token for a raw unit, or null when the unit is not in the table. */
export function normalizeUnit(raw) {
	return entryOf(raw)?.token ?? null
}

/** Canonical token for a multi-word unit written with its alias's own spacing, or null (never a squashed join). */
export function spacedAliasUnit(raw) {
	return SPACED.get(String(raw).trim().replace(/\s+/g, " ").toLowerCase())?.token ?? null
}

/** Dimension of a unit ("length", "currency:KRW", ...), or null. */
export function dimensionOf(token) {
	return entryOf(token)?.dimension ?? null
}

/**
 * Exact factor from one unit to another of the same dimension: to = from * num / den (+ offset for
 * affine scales). Null across dimensions, across currencies, or for an unknown unit.
 */
export function convertFactor(from, to) {
	const a = entryOf(from)
	const b = entryOf(to)
	if (!a || !b || a.dimension !== b.dimension) return null
	const { num, den } = div(a.factor, b.factor)
	const offset = div(sub(a.offset, b.offset), b.factor)
	return offset.num === 0n ? { num, den } : { num, den, offset: { num: offset.num, den: offset.den } }
}

/** Final-sound class of the unit's Korean reading: "open", "closed", or "l"; null when unknown. */
export function koreanReadingOf(token) {
	return entryOf(token)?.reading ?? null
}
