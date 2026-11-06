// markdown-closers.mjs - the Markdown closer runs a converter writes after a piece of text, read with
// the CommonMark inline grammar instead of a hand-written pattern. A closer run is any sequence of:
// an inline link ending `](dest "title")` (the destination either in <...> or bare with balanced
// parentheses, the optional title in "...", '...' or (...), backslash escapes inside both), a full or
// collapsed reference ending `][ref]` / `][]`, a whole image `![alt](...)` or `![alt][ref]` (its alt
// text is not context), the `[` that opened a link whose text is all markup (`[![x](i.png)](/p)`),
// an emphasis, strike or code delimiter, a bare `)`, `]` or `>`, and a backslash-escaped closer
// (`\*`, `\_`, `\]`, `\)`, `\~`, a backtick), which stands for the raw character and is skipped like
// it. An escaped opener (`\[`, `\(`) is a real character and ends the run. Shared by the conversion
// probe's sign reading and its link-syntax spans. Pure; no imports.

const SIMPLE = new Set(["*", "_", "~", "`", ")", "]", ">"])
const BREAK = "\u0001"

/** Whether the character at `index` is backslash-escaped (an odd run of backslashes before it). */
export function escapedAt(text, index) {
	let count = 0
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) count++
	return count % 2 === 1
}

/** The end (exclusive) of an inline link target `dest "title")` that starts right after its "(", or -1. */
export function inlineTargetEnd(text, from) {
	let i = from
	const space = () => {
		while (text[i] === " " || text[i] === "\t") i++
	}
	space()
	if (text[i] === "<") {
		for (i++; i < text.length && text[i] !== ">"; i++) {
			if (text[i] === "\\") i++
			else if (text[i] === "<" || text[i] === BREAK) return -1
		}
		if (text[i++] !== ">") return -1
	} else {
		let depth = 0
		for (; i < text.length; i++) {
			const ch = text[i]
			if (ch === "\\") i++
			else if (ch === "(") depth++
			else if (ch === ")" && depth === 0) break
			else if (ch === ")") depth--
			else if (ch === " " || ch === "\t" || ch === BREAK) break
		}
		if (depth !== 0) return -1
	}
	const destEnd = i
	space()
	const open = text[i]
	if (i > destEnd && (open === '"' || open === "'" || open === "(")) {
		const close = open === "(" ? ")" : open
		for (i++; i < text.length && text[i] !== close; i++) {
			if (text[i] === "\\") i++
			else if (text[i] === BREAK || (open === "(" && text[i] === "(")) return -1
		}
		if (text[i++] !== close) return -1
		space()
	}
	return text[i] === ")" ? i + 1 : -1
}

/** The unescaped "[" that the unescaped "]" at `close` closes (brackets balance), or -1. */
function openerOf(text, close) {
	let depth = 0
	for (let i = close; i >= 0 && text[i] !== BREAK; i--) {
		if ((text[i] !== "[" && text[i] !== "]") || escapedAt(text, i)) continue
		depth += text[i] === "]" ? 1 : -1
		if (depth === 0) return i
	}
	return -1
}

/** The "](" positions whose inline target ends exactly at `end`, leftmost first (so a title holding "](" is not cut). */
function inlineLinkClose(text, end) {
	const from = Math.max(0, text.lastIndexOf(BREAK, end - 1))
	for (let k = text.indexOf("](", from); k !== -1 && k < end; k = text.indexOf("](", k + 1)) {
		if (!escapedAt(text, k) && inlineTargetEnd(text, k + 2) === end) return k
	}
	return -1
}

/** Where the link or image tail ending at `end` starts, and whether its "[" is still open; null when none ends there. */
function linkTail(text, end) {
	let close = -1
	if (text[end - 1] === ")") close = inlineLinkClose(text, end)
	else if (text[end - 1] === "]" && !escapedAt(text, end - 1)) {
		const ref = openerOf(text, end - 1)
		if (ref > 0 && text[ref - 1] === "]" && !escapedAt(text, ref - 1)) close = ref - 1
	}
	if (close === -1) return null
	const open = openerOf(text, close)
	if (open > 0 && text[open - 1] === "!" && !escapedAt(text, open - 1)) return { start: open - 1, opened: 0 }
	return { start: close, opened: open === -1 ? 0 : 1 }
}

/** `text` without the Markdown closer run it ends with. */
export function stripClosers(text) {
	let end = text.length
	let owed = 0
	for (;;) {
		const tail = linkTail(text, end)
		if (tail) {
			end = tail.start
			owed += tail.opened
			continue
		}
		const ch = text[end - 1]
		if (SIMPLE.has(ch)) end -= escapedAt(text, end - 1) ? 2 : 1
		else if (ch === "[" && owed > 0 && !escapedAt(text, end - 1)) {
			end--
			owed--
		} else return text.slice(0, end)
	}
}

/** [start, end) spans of every inline link or image with its target (an image from its "!"), for link-syntax cover. */
export function inlineLinkSpans(text) {
	const spans = []
	for (let k = text.indexOf("]("); k !== -1; k = text.indexOf("](", k + 1)) {
		const end = escapedAt(text, k) ? -1 : inlineTargetEnd(text, k + 2)
		if (end === -1) continue
		const open = openerOf(text, k)
		spans.push([open > 0 && text[open - 1] === "!" ? open - 1 : k, end])
	}
	return spans
}
