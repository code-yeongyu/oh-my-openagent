// sentence-split.mjs - deterministic sentence index for snapshot text.
//
// splitSentences(text) returns [{ sid, start, end, text }] with sid "s<k>" (1-based) and
// start/end as offsets into the raw text, so text.slice(start, end) === record.text.
// Boundaries: a line break; ". ! ?" followed by whitespace or end of line (known
// abbreviations such as "e.g." excepted); and the Korean endings da. yo. nida. kka? even
// with no following space, unless closing punctuation follows (quoted speech such as
// '...da."rago' then needs whitespace like any other terminator). "no." is an abbreviation
// only before a number ("No. 5"). Plain Node ESM, no dependencies.

import { normalizeText } from "./text-normalize.mjs"

const TERMINATORS = ".!?"
const CLOSERS = "\"')]}\u201D\u2019\u00BB\u300D\u300F"
const KOREAN_PERIOD_ENDINGS = new Set(["\uB2E4", "\uC694"]) // da, yo (nida ends in da)
const KOREAN_QUESTION_ENDING = "\uAE4C" // kka
const ABBREVIATIONS = new Set([
	"e.g", "i.e", "etc", "vs", "cf", "approx", "al", "fig", "no", "mr", "mrs", "ms", "dr", "prof", "inc", "ltd", "jr", "sr",
])
const SPACE = /\s/u

function isKoreanEnding(line, at) {
	const prev = line[at - 1]
	if (line[at] === ".") return KOREAN_PERIOD_ENDINGS.has(prev)
	return line[at] === "?" && prev === KOREAN_QUESTION_ENDING
}

function isAbbreviation(line, from, at) {
	let k = at
	while (k > from && !SPACE.test(line[k - 1])) k--
	const word = line.slice(k, at).replace(/^[("'[]+/u, "").toLowerCase()
	if (word === "no") return /^\s*\d/u.test(line.slice(at + 1))
	return ABBREVIATIONS.has(word)
}

function pushSegment(line, base, from, to, out) {
	let start = from
	let end = to
	while (start < end && SPACE.test(line[start])) start++
	while (end > start && SPACE.test(line[end - 1])) end--
	const text = line.slice(start, end)
	if (normalizeText(text) === "") return
	out.push({ sid: `s${out.length + 1}`, start: base + start, end: base + end, text })
}

function splitLine(line, base, out) {
	let from = 0
	for (let i = 0; i < line.length; i++) {
		if (!TERMINATORS.includes(line[i])) continue
		let j = i + 1
		while (j < line.length && (TERMINATORS.includes(line[j]) || CLOSERS.includes(line[j]))) j++
		const atBreak = j >= line.length || SPACE.test(line[j])
		const closed = [...line.slice(i + 1, j)].some((c) => CLOSERS.includes(c))
		const korean = !closed && isKoreanEnding(line, i)
		const abbreviation = line[i] === "." && !korean && isAbbreviation(line, from, i)
		if ((atBreak || korean) && !abbreviation) {
			pushSegment(line, base, from, j, out)
			from = j
		}
		i = j - 1
	}
	pushSegment(line, base, from, line.length, out)
}

export function splitSentences(text) {
	const source = String(text ?? "")
	const out = []
	let base = 0
	while (base <= source.length) {
		const newline = source.indexOf("\n", base)
		const stop = newline === -1 ? source.length : newline
		splitLine(source.slice(base, stop), base, out)
		if (newline === -1) break
		base = newline + 1
	}
	return out
}
