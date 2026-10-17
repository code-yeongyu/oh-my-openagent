// html-lite.mjs - a dependency-free HTML tokenizer for report checks.
//
// Single forward scan with indexOf (no whole-document regex, no backtracking). Produces a
// LiteNode tree: { tag, attrs, children, parent, line, text, raw }. Text nodes carry
// tag "#text"; <style>/<script>/<svg> keep their inner source in `raw` and have no parsed
// children. The "#document" root also carries `ids` (id -> occurrence count) so
// selectorPath can tell whether an id is unique. Plain Node ESM, no dependencies.

import { decodeEntities } from "./entities.mjs"

export { decodeEntities }

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])
const RAW_TAGS = new Set(["style", "script", "svg"])
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"]
const P_CLOSERS = new Set([
	"address", "article", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer",
	"form", "header", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul", ...HEADINGS,
])
const P_SCOPE = new Set(["td", "th", "caption", "button", "body", "html"])
const LI_SCOPE = new Set(["ul", "ol", "menu", "body", "html"])
const PROSE_SKIP = new Set(["code", "pre", "kbd", "samp", "script", "style", "svg"])
const SAFE_ID = /^[A-Za-z_][\w-]*$/

export const PROSE_TAGS = new Set(["p", "li", ...HEADINGS, "td", "th", "figcaption", "blockquote", "dd", "dt"])
const PROSE_BREAKS = new Set([...P_CLOSERS, ...PROSE_TAGS, "br", "tr"])

function makeNode(tag, attrs, parent, line) {
	return { tag, attrs, children: [], parent, line, text: "", raw: null }
}

function lineStarts(source) {
	const starts = [0]
	for (let at = source.indexOf("\n"); at !== -1; at = source.indexOf("\n", at + 1)) starts.push(at + 1)
	return starts
}

function lineAt(starts, offset) {
	let lo = 0
	let hi = starts.length - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (starts[mid] <= offset) lo = mid
		else hi = mid - 1
	}
	return lo + 1
}

const isSpace = (ch) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f"
const isLetter = (ch) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")

function skipSpaces(source, at) {
	while (at < source.length && isSpace(source[at])) at++
	return at
}

/** Read `<name attrs...>` starting just after `<`. */
function readTag(source, start) {
	const end = source.length
	let at = start
	while (at < end && !isSpace(source[at]) && source[at] !== ">" && source[at] !== "/") at++
	const name = source.slice(start, at).toLowerCase()
	const attrs = {}
	let selfClosing = false
	while (at < end) {
		const ch = source[at]
		if (isSpace(ch)) { at++; continue }
		if (ch === ">") return { name, attrs, end: at + 1, selfClosing }
		selfClosing = ch === "/" && source[at + 1] === ">"
		if (ch === "/") { at++; continue }
		let stop = at + 1
		while (stop < end && !isSpace(source[stop]) && source[stop] !== "/" && source[stop] !== ">" && source[stop] !== "=") stop++
		const key = source.slice(at, stop).toLowerCase()
		at = skipSpaces(source, stop)
		let value = ""
		if (source[at] === "=") {
			at = skipSpaces(source, at + 1)
			const quote = source[at]
			if (quote === '"' || quote === "'") {
				const close = source.indexOf(quote, at + 1)
				const valueEnd = close === -1 ? end : close
				value = source.slice(at + 1, valueEnd)
				at = valueEnd + 1
			} else {
				let valueEnd = at
				while (valueEnd < end && !isSpace(source[valueEnd]) && source[valueEnd] !== ">") valueEnd++
				value = source.slice(at, valueEnd)
				at = valueEnd
			}
		}
		if (key !== "__proto__" && !Object.hasOwn(attrs, key)) attrs[key] = decodeEntities(value)
	}
	return { name, attrs, end, selfClosing }
}

function tagNameAt(source, at, tag) {
	if (source.slice(at, at + tag.length).toLowerCase() !== tag) return false
	const next = source[at + tag.length] ?? ">"
	return isSpace(next) || next === ">" || next === "/"
}

/** Find the close of a raw element; nested <svg> is depth-counted. Returns [innerEnd, resumeAt]. */
function findRawClose(source, from, tag) {
	let depth = 0
	for (let lt = source.indexOf("<", from); lt !== -1; lt = source.indexOf("<", lt + 1)) {
		if (source[lt + 1] === "/" && tagNameAt(source, lt + 2, tag)) {
			if (depth === 0) {
				const gt = source.indexOf(">", lt)
				return [lt, gt === -1 ? source.length : gt + 1]
			}
			depth--
		} else if (tag === "svg" && tagNameAt(source, lt + 1, tag)) {
			depth++
		}
	}
	return [source.length, source.length]
}

/** Parse an HTML string into a LiteNode tree rooted at "#document"; never throws on malformed input. */
export function parseHtml(source) {
	const src = String(source)
	const starts = lineStarts(src)
	const root = makeNode("#document", {}, null, 1)
	root.ids = new Map()
	const stack = [root]
	let sawBody = false
	let textStart = 0
	let at = 0
	const top = () => stack[stack.length - 1]
	const flushText = (to) => {
		if (to > textStart) {
			const node = makeNode("#text", {}, top(), lineAt(starts, textStart))
			node.text = decodeEntities(src.slice(textStart, to))
			top().children.push(node)
		}
	}
	const closeWithin = (tag, scope) => {
		for (let k = stack.length - 1; k > 0; k--) {
			if (stack[k].tag === tag) { stack.length = k; return }
			if (scope.has(stack[k].tag)) return
		}
	}
	while (at < src.length) {
		const lt = src.indexOf("<", at)
		if (lt === -1) break
		const next = src[lt + 1] ?? ""
		if (src.startsWith("<!--", lt)) {
			flushText(lt)
			const close = src.indexOf("-->", lt + 4)
			at = textStart = close === -1 ? src.length : close + 3
		} else if (next === "!" || next === "?") {
			flushText(lt)
			const close = src.indexOf(">", lt)
			at = textStart = close === -1 ? src.length : close + 1
		} else if (next === "/" && isLetter(src[lt + 2] ?? "")) {
			flushText(lt)
			const tag = readTag(src, lt + 2)
			if (tag.name !== "body" && tag.name !== "html") {
				for (let k = stack.length - 1; k > 0; k--) {
					if (stack[k].tag === tag.name) { stack.length = k; break }
				}
			}
			at = textStart = tag.end
		} else if (isLetter(next)) {
			flushText(lt)
			const tag = readTag(src, lt + 1)
			at = textStart = tag.end
			if ((tag.name === "html" || tag.name === "body" || tag.name === "head") && stack.some((n) => n.tag === tag.name)) continue
			if (P_CLOSERS.has(tag.name)) closeWithin("p", P_SCOPE)
			if (tag.name === "li") closeWithin("li", LI_SCOPE)
			const node = makeNode(tag.name, tag.attrs, top(), lineAt(starts, lt))
			top().children.push(node)
			if (tag.name === "body") sawBody = true
			if (tag.attrs.id) root.ids.set(tag.attrs.id, (root.ids.get(tag.attrs.id) ?? 0) + 1)
			if (RAW_TAGS.has(tag.name)) {
				node.raw = ""
				if (!tag.selfClosing) {
					const [innerEnd, resume] = findRawClose(src, tag.end, tag.name)
					node.raw = src.slice(tag.end, innerEnd)
					at = textStart = resume
				}
			} else if (!VOID_TAGS.has(tag.name)) {
				stack.push(node)
			}
		} else {
			at = lt + 1
		}
	}
	flushText(src.length)
	if (!sawBody) wrapInBody(root)
	return root
}

/** Fragments without <body>: move everything except <head> under a synthesized body. */
function wrapInBody(root) {
	const host = root.children.find((child) => child.tag === "html") ?? root
	const kept = host.children.filter((child) => child.tag === "head")
	const moved = host.children.filter((child) => child.tag !== "head")
	const body = makeNode("body", {}, host, moved[0]?.line ?? 1)
	for (const child of moved) child.parent = body
	body.children = moved
	host.children = [...kept, body]
}

function segment(node) {
	const same = node.parent.children.filter((child) => child.tag === node.tag)
	return same.length > 1 ? `${node.tag}:nth-of-type(${same.indexOf(node) + 1})` : node.tag
}

/** CSS selector for a node: nearest unique-id anchor, else `body > tag:nth-of-type(k) > ...`. */
export function selectorPath(node) {
	let root = node
	while (root.parent) root = root.parent
	const ids = root.ids ?? new Map()
	const segments = []
	for (let cur = node.tag === "#text" ? node.parent : node; cur?.parent; cur = cur.parent) {
		const id = cur.attrs.id
		if (id && SAFE_ID.test(id) && ids.get(id) === 1) return [`#${id}`, ...segments].join(" > ")
		if (cur.tag === "body") return ["body", ...segments].join(" > ")
		if (cur.tag === "html") break
		segments.unshift(segment(cur))
	}
	return segments.join(" > ")
}

/** Descendant text minus code/pre/kbd/samp/script/style/svg, whitespace collapsed. */
export function proseText(node) {
	const parts = []
	const walk = (cur) => {
		if (cur.tag === "#text") { parts.push(cur.text); return }
		if (PROSE_SKIP.has(cur.tag)) return
		const breaks = PROSE_BREAKS.has(cur.tag)
		if (breaks) parts.push(" ")
		for (const child of cur.children) walk(child)
		if (breaks) parts.push(" ")
	}
	for (const child of node.children) walk(child)
	return parts.join("").replace(/\s+/g, " ").trim()
}
