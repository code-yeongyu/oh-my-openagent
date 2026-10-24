// Korean particle normalization after a filled value: read the value's final sound, then pick the
// particle form. Hangul and the particle table are \u escapes (this directory ships no Hangul).

// Unit token -> reading of its Korean name. Duplicated from the planned units.koreanReadingOf so this
// module has no dependency on a sibling not yet landed; the units module reconciles the two tables.
// Hangul unit words (won, dalleo, jo, eok, ...) need no row: they are read by code point.
const UNIT_READINGS = new Map([
	["%", "open"], // peosenteu
	["%p", "open"], // peosenteu pointeu
	["pp", "open"], // peosenteu pointeu
	["m", "open"], // miteo
	["mm", "open"], // millimiteo
	["cm", "open"], // sentimiteo
	["km", "open"], // killomiteo
	["kg", "closed"], // killogeuraem
	["g", "closed"], // geuraem
	["t", "closed"], // ton
	["s", "open"], // cho
	["ms", "open"], // millicho
	["min", "closed"], // bun
	["h", "closed"], // sigan
	["B", "open"], // baiteu
	["KB", "open"], // killobaiteu
	["MB", "open"], // megabaiteu
	["GB", "open"], // gigabaiteu
	["TB", "open"], // terabaiteu
	["C", "open"], // do
	["\u00B0C", "open"], // do
	["F", "open"], // do
	["\u00B0F", "open"], // do
	["USD", "open"], // dalleo
	["$", "open"], // dalleo
	["KRW", "closed"], // won
	["EUR", "open"], // yuro
	["JPY", "closed"], // en
	["x", "open"], // bae
	["\u00D7", "open"], // bae
])

// Sino-Korean digit readings: yeong il i sam sa o yuk chil pal gu.
const DIGIT_READINGS = Object.freeze(["closed", "l", "open", "closed", "open", "open", "closed", "l", "l", "open"])

// Spoken ending of a power of ten beyond the units digit: sip baek cheon, then the 10^4 group markers
// man eok jo gyeong. Only jo (10^12) is open.
const TEN_POWER_READINGS = Object.freeze(["closed", "closed", "closed"])
const GROUP_READINGS = Object.freeze({ 4: "closed", 8: "closed", 12: "open", 16: "closed" })

// [particle, form after an open vowel, form after final l, form after another final consonant]
const PARTICLES = Object.freeze([
	Object.freeze(["\uC73C\uB85C", "\uB85C", "\uB85C", "\uC73C\uB85C"]),
	Object.freeze(["\uB85C", "\uB85C", "\uB85C", "\uC73C\uB85C"]),
	Object.freeze(["\uC740", "\uB294", "\uC740", "\uC740"]),
	Object.freeze(["\uB294", "\uB294", "\uC740", "\uC740"]),
	Object.freeze(["\uC774", "\uAC00", "\uC774", "\uC774"]),
	Object.freeze(["\uAC00", "\uAC00", "\uC774", "\uC774"]),
	Object.freeze(["\uC744", "\uB97C", "\uC744", "\uC744"]),
	Object.freeze(["\uB97C", "\uB97C", "\uC744", "\uC744"]),
	Object.freeze(["\uC640", "\uC640", "\uACFC", "\uACFC"]),
	Object.freeze(["\uACFC", "\uC640", "\uACFC", "\uACFC"]),
])
const FORM_INDEX = Object.freeze({ open: 1, l: 2, closed: 3 })

const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
const BOUNDARY = /^[\s\p{P}]/u
const TRAILING_DIGITS = /([0-9][0-9,]*)(?:\.([0-9]+))?$/

function hangulReading(char) {
	const code = char.codePointAt(0)
	if (code === undefined || code < HANGUL_FIRST || code > HANGUL_LAST) return null
	const finalConsonant = (code - HANGUL_FIRST) % 28
	if (finalConsonant === 0) return "open"
	return finalConsonant === 8 ? "l" : "closed"
}

function numberReading(text) {
	const match = TRAILING_DIGITS.exec(text)
	if (!match) return null
	// Decimals read digit by digit: 6.50 ends on yeong, so a trailing 0 after the point is closed.
	if (match[2] !== undefined) return DIGIT_READINGS[Number(match[2].at(-1))]
	const digits = match[1].replaceAll(",", "")
	const trailingZeros = digits.length - digits.replace(/0+$/, "").length
	if (trailingZeros === 0 || trailingZeros === digits.length) return DIGIT_READINGS[Number(digits.at(-1))]
	// From 10^4 up the spoken end is the last non-zero group word (sipjo ends on jo), not sip/baek/cheon.
	if (trailingZeros >= 4) return GROUP_READINGS[trailingZeros - (trailingZeros % 4)] ?? null
	return TEN_POWER_READINGS[trailingZeros - 1]
}

export function finalReading(valueText, unitToken) {
	if (unitToken !== null && unitToken !== undefined) return UNIT_READINGS.get(unitToken) ?? hangulReading(unitToken.at(-1) ?? "")
	const text = valueText.trimEnd()
	const last = text.at(-1)
	if (last === undefined) return null
	const hangul = hangulReading(last)
	if (hangul !== null) return hangul
	if (last >= "0" && last <= "9") return numberReading(text)
	const token = /[^\s0-9.,]+$/u.exec(text)?.[0] ?? ""
	return UNIT_READINGS.get(token) ?? null
}

export function rewriteParticle(following, reading) {
	const entry = PARTICLES.find(([particle]) => following.startsWith(particle))
	if (entry === undefined) return { text: following, applied: false, candidate: false }
	const rest = following.slice(entry[0].length)
	const index = FORM_INDEX[reading]
	if ((rest !== "" && !BOUNDARY.test(rest)) || index === undefined) return { text: following, applied: false, candidate: true }
	return { text: entry[index] + rest, applied: true, candidate: true }
}
