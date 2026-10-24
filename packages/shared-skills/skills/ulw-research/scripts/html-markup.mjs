// Byte-preserving HTML boundaries for polish. No CSS or visibility inference.
import { readTag } from "./html-lite.mjs"

const RAW = new Set(["script", "style"])
const FROZEN = new Set([...RAW, "template"])
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])
const isLetter = (ch) => /[a-z]/i.test(ch ?? "")

function scan(src, at, visit) {
	while (at < src.length) {
		const start = src.indexOf("<", at)
		if (start === -1) return
		const next = src[start + 1]
		let kind
		let end
		let tag = null
		if (src.startsWith("<!--", start)) {
			// From start + 2 so the abrupt closes <!--> and <!---> end where the HTML tokenizer ends them.
			kind = "skip"
			const stop = src.indexOf("-->", start + 2)
			end = stop === -1 ? src.length : stop + 3
		} else if (next === "!" || next === "?" || (next === "/" && !isLetter(src[start + 2]))) {
			// Declarations, <?...> and </ + non-letter (</> included) are bogus comments up to the next ">".
			kind = "skip"
			const stop = src.indexOf(">", start + 2)
			end = stop === -1 ? src.length : stop + 1
		} else if (isLetter(next) || (next === "/" && isLetter(src[start + 2]))) {
			kind = next === "/" ? "close" : "open"
			tag = readTag(src, start + (kind === "close" ? 2 : 1))
			end = tag.end
		} else {
			at = start + 1
			continue
		}
		const resume = visit(kind, start, end, tag)
		if (resume === Infinity) return
		at = resume ?? (kind === "open" && RAW.has(tag.name) ? closeOf(src, end, tag.name) : end)
	}
}

// Script data with its escaped and double-escaped states: a </script> inside <!--<script>...-->
// does not end the script. Returns the end of the closing tag, or the end of input.
const SCRIPT_MARKS = { data: /<!--|<\/script(?=[\s/>])/gi, escaped: /-->|<\/?script(?=[\s/>])/gi, double: /-->|<\/script(?=[\s/>])/gi }
function scriptEnd(src, from) {
	let state = "data"
	let at = from
	for (;;) {
		const marks = SCRIPT_MARKS[state]
		marks.lastIndex = at
		const match = marks.exec(src)
		if (!match) return src.length
		const token = match[0].toLowerCase()
		if (token === "-->") [state, at] = ["data", match.index + 3]
		else if (token === "<!--") [state, at] = ["escaped", match.index + 2]
		else if (token === "<script") [state, at] = ["double", match.index + 7]
		else if (state === "double") [state, at] = ["escaped", match.index + 8]
		else return readTag(src, match.index + 2).end
	}
}

function closeOf(src, from, name) {
	if (name === "script") return scriptEnd(src, from)
	if (RAW.has(name)) {
		const close = new RegExp(`</${name}(?=[\\s/>])[^>]*>`, "gi")
		close.lastIndex = from
		const match = close.exec(src)
		return match ? match.index + match[0].length : src.length
	}
	let depth = 0
	let stop = src.length
	scan(src, from, (kind, _start, end, tag) => {
		if (tag?.name !== name) return undefined
		if (kind === "open") depth++
		else if (depth === 0) {
			stop = end
			return Infinity
		} else depth--
		return undefined
	})
	return stop
}

const endOf = (src, end, tag) => VOID.has(tag.name) ? end : closeOf(src, end, tag.name)

/** Raw markup sequence, corresponding text slots, and markup with frozen elements omitted. */
export function markupParts(html) {
	const src = String(html)
	const markup = []
	const text = []
	let source = ""
	let kept = 0
	scan(src, 0, (kind, start, end, tag) => {
		const frozen = kind === "open" && FROZEN.has(tag.name)
		const stop = frozen ? endOf(src, end, tag) : end
		text.push(src.slice(kept, start))
		markup.push(src.slice(start, stop))
		source += src.slice(kept, start) + (frozen || kind === "skip" ? " " : src.slice(start, stop))
		kept = stop
		return stop
	})
	text.push(src.slice(kept))
	source += src.slice(kept)
	return { markup, text, source }
}

/** Whole elements accepted by the caller; nested matches stay within the outer match. */
export function elementSpans(html, accept) {
	const src = String(html)
	const spans = []
	scan(src, 0, (kind, start, end, tag) => {
		if (kind !== "open" || !accept(tag.name, tag.attrs)) return undefined
		const stop = endOf(src, end, tag)
		spans.push({ start, end: stop, tag })
		return stop
	})
	return spans
}

export function tagAttributes(html) {
	const tags = []
	scan(String(html), 0, (kind, _start, _end, tag) => {
		if (kind === "open") tags.push({ name: tag.name, attrs: tag.attrs })
		return undefined
	})
	return tags
}

/**
 * Constructs this tokenizer does not model exactly; renderer output never contains them, so polish
 * refuses a document holding any of them instead of trusting the markup comparison.
 */
export function ambiguousMarkup(html) {
	const src = String(html)
	const found = new Set()
	if (/<\/(?![a-z])/i.test(src)) found.add("</ before a non-letter")
	if (/<!\[CDATA\[/i.test(src)) found.add("<![CDATA[")
	if (src.includes("<?")) found.add("<?")
	if (src.includes("--!>")) found.add("--!>")
	scan(src, 0, (kind, start, end, tag) => {
		if (kind !== "skip" && src.slice(start + 1, end).includes("<")) found.add("< inside a tag or attribute value")
		if (kind === "open" && RAW.has(tag.name) && src.slice(end, closeOf(src, end, tag.name)).includes("<!--")) found.add(`<!-- inside ${tag.name}`)
		return undefined
	})
	return [...found]
}

/** One character reference token of a text node: & up to the first ; or non-name character. */
export const CHARACTER_REFERENCE = /&[^;\s<&]*;?/g

/**
 * The skeleton of a document: every markup token (tags, comments, bogus comments and the frozen
 * content of script/style/template) and every character reference of a text node, in document
 * order, each with its byte offset. Polish may change text node characters only, and an edit can
 * carry neither <, > nor & and may not touch a character reference, so an edited span holds no
 * skeleton token: a polished document keeps this sequence byte-identical.
 */
export function skeletonTokens(html) {
	const { markup, text } = markupParts(html)
	const tokens = []
	let at = 0
	text.forEach((slot, index) => {
		for (const match of slot.matchAll(CHARACTER_REFERENCE)) tokens.push({ kind: "reference", value: match[0], offset: at + match.index })
		at += slot.length
		if (index < markup.length) {
			tokens.push({ kind: "markup", value: markup[index], offset: at })
			at += markup[index].length
		}
	})
	return tokens
}

const describeToken = (token) => (token ? `${token.kind} ${JSON.stringify(token.value)} at offset ${token.offset}` : "end of document")

/** The first skeleton token two documents disagree on, as a message, or null when they agree. */
export function skeletonChange(beforeHtml, afterHtml) {
	const [before, after] = [skeletonTokens(beforeHtml), skeletonTokens(afterHtml)]
	for (let index = 0; index < Math.max(before.length, after.length); index++) {
		if (before[index]?.value === after[index]?.value) continue
		return `skeleton changed at token ${index}: ${describeToken(before[index])} became ${describeToken(after[index])}`
	}
	return null
}
