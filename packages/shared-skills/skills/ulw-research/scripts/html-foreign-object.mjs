// html-foreign-object.mjs - the <foreignObject> carve-out for the html-lite tokenizer.
//
// An <svg> element is raw drawing markup, except <foreignObject>, which by definition holds
// HTML. The tokenizer keeps the svg's inner source in `raw` and additionally parses each
// foreignObject subtree into real children of the svg node, so the fidelity checks read chart
// HTML exactly like prose while the rest of the svg stays raw. Plain Node ESM, no dependencies.

import { makeNode, readTag } from "./html-lite.mjs"

/** Newlines in text before offset `to`. */
function newlinesBefore(text, to) {
	let count = 0
	for (let at = text.indexOf("\n"); at !== -1 && at < to; at = text.indexOf("\n", at + 1)) count++
	return count
}

/** Shift a parsed subtree's line numbers by `delta` (fragment lines are relative to the fragment). */
function shiftLines(node, delta) {
	node.line += delta
	for (const child of node.children) shiftLines(child, delta)
}

const isLetter = (ch) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")

/**
 * Parse an svg node's <foreignObject> subtrees into real children; the rest of the svg stays raw.
 * @param {object} node an <svg> LiteNode whose `raw` holds its inner source
 * @param {number} rawStartLine document line of the first raw character
 * @param {(source: string) => object} parseHtml the tokenizer, passed in so this module never imports it back
 */
export function attachForeignObjects(node, rawStartLine, parseHtml) {
	const raw = node.raw ?? ""
	for (let lt = raw.indexOf("<"); lt !== -1; lt = raw.indexOf("<", lt + 1)) {
		if (raw[lt + 1] === "/" || !isLetter(raw[lt + 1] ?? "")) continue
		const open = readTag(raw, lt + 1)
		if (open.name !== "foreignobject" || open.selfClosing) continue
		let depth = 0
		let innerEnd = raw.length
		let resume = raw.length
		for (let at = raw.indexOf("<", open.end); at !== -1; at = raw.indexOf("<", at + 1)) {
			const closing = raw[at + 1] === "/"
			if (!closing && !isLetter(raw[at + 1] ?? "")) continue
			if (readTag(raw, at + (closing ? 2 : 1)).name !== "foreignobject") continue
			if (closing) {
				if (depth === 0) { innerEnd = at; const gt = raw.indexOf(">", at); resume = gt === -1 ? raw.length : gt + 1; break }
				depth--
			} else depth++
		}
		// Tags are lowercased by readTag, so the attached node is "foreignobject" like any parsed tag.
		const fo = makeNode("foreignobject", open.attrs, node, rawStartLine + newlinesBefore(raw, lt))
		const frag = parseHtml(raw.slice(open.end, innerEnd))
		const body = frag.children.find((child) => child.tag === "body") ?? frag
		for (const child of body.children) {
			child.parent = fo
			shiftLines(child, rawStartLine + newlinesBefore(raw, open.end) - 1)
			fo.children.push(child)
		}
		node.children.push(fo)
		lt = resume - 1
	}
}
