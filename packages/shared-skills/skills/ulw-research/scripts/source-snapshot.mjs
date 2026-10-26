// source-snapshot.mjs - the per-source snapshot that fact locators read.
//
// snapshotFromHtml turns a page into text.txt form: one line per block (prose blocks via
// proseText, one table cell per line; head, scripts, styles and code are dropped). writeSnapshot
// writes <sourcesDir>/<S-id>/ with text.txt (pages joined by a form feed), source.html when html
// was given, meta.json, sentences.jsonl (sid S<n>:s<k>) and acronyms.json. The sha256 covers
// text.txt only. Nothing here touches the network: the caller supplies the html or text.
// Plain Node ESM, node: builtins and sibling imports only.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { parseHtml, PROSE_TAGS, proseText } from "./html-lite.mjs"
import { splitSentences } from "./sentence-split.mjs"

const SKIP = new Set(["head", "script", "style", "svg", "code", "pre", "kbd", "samp", "template", "noscript"])
const INLINE = new Set([
	"a", "abbr", "b", "bdi", "bdo", "cite", "data", "del", "dfn", "em", "font", "i", "ins", "label", "mark", "q", "s",
	"small", "span", "strong", "sub", "sup", "time", "u", "var",
])
const SOURCE_ID = /^S[1-9]\d*$/
const EXTRACTOR = /^(?:tool:source-snapshot@1|model|extractor:[\w.@+-]+)$/
const KINDS = new Set(["page", "command", "document"])
const PROVENANCE = new Set(["primary", "secondary", "unknown"])
const ACRONYM_AFTER = /\(([A-Z]{2,6})\)/g
const ACRONYM_BEFORE = /(?<![\p{L}\p{N}])([A-Z]{2,6})\s?\(([A-Z][^()\n]{2,79})\)/gu
const NAME_WORD = /^[A-Z][\p{L}\p{N}-]*$/u
const CONNECTOR = new Set(["of", "and", "for", "the", "in", "on", "to", "&"])

/**
 * Block lines of a page: { root, text, blocks: [{ node, start, end }] } where text joins the block
 * texts with "\n" and text.slice(start, end) is one block. fact-locate reads cells through `node`.
 */
export function snapshotBlocks(html) {
	const root = parseHtml(html)
	const lines = []
	let buffer = ""
	const flush = (node) => {
		const line = buffer.replace(/\s+/g, " ").trim()
		buffer = ""
		if (line) lines.push({ node, text: line })
	}
	const walk = (node) => {
		for (const child of node.children) {
			if (child.tag === "#text") buffer += child.text
			else if (SKIP.has(child.tag)) continue
			else if (child.tag === "br") flush(node)
			else if (INLINE.has(child.tag)) walk(child)
			else if (PROSE_TAGS.has(child.tag)) {
				flush(node)
				const line = proseText(child)
				if (line) lines.push({ node: child, text: line })
			} else {
				flush(node)
				walk(child)
				flush(child)
			}
		}
	}
	walk(root)
	flush(root)
	const blocks = []
	let at = 0
	for (const line of lines) {
		blocks.push({ node: line.node, start: at, end: at + line.text.length })
		at += line.text.length + 1
	}
	return { root, text: lines.map((line) => line.text).join("\n"), blocks }
}

/** text.txt form of an html page. */
export function snapshotFromHtml(html) {
	return snapshotBlocks(html).text
}

/** Sentence index rows { sid: "S<n>:s<k>", start, end, text }; a form feed (page break) always ends a sentence. */
export function indexSentences(text, sourceId) {
	return splitSentences(text.replace(/\f/g, "\n")).map((row) => ({
		sid: `${sourceId}:${row.sid}`,
		start: row.start,
		end: row.end,
		text: text.slice(row.start, row.end),
	}))
}

const sentenceIdAt = (sentences, offset) => sentences.find((row) => row.start <= offset && offset < row.end)?.sid ?? null

/** "High Bandwidth Memory (HBM)": the capitalized words before the parenthesis, at most one per letter. */
function nameBefore(text, at, letters) {
	const prefix = text.slice(Math.max(0, at - 160), at)
	if (!/\S[ \t]?$/.test(prefix)) return null
	const words = [...prefix.matchAll(/\S+/g)]
	const picked = []
	let content = 0
	for (let k = words.length - 1; k >= 0 && content < letters; k--) {
		const word = words[k][0]
		if (NAME_WORD.test(word)) content++
		else if (!CONNECTOR.has(word) || picked.length === 0) break
		picked.unshift(words[k])
	}
	while (picked.length > 0 && CONNECTOR.has(picked[0][0])) picked.shift()
	if (picked.length === 0) return null
	const start = at - prefix.length + picked[0].index
	const end = at - prefix.length + picked[picked.length - 1].index + picked[picked.length - 1][0].length
	return { start, expansion: text.slice(start, end) }
}

/** Every `Full Name (ACR)` and `ACR (Full Name)` in the text, ordered by position. */
export function findAcronyms(text, sentences) {
	const entries = []
	for (const match of text.matchAll(ACRONYM_AFTER)) {
		const name = nameBefore(text, match.index, match[1].length)
		if (!name || name.expansion === match[1]) continue
		entries.push({ acronym: match[1], expansion: name.expansion, span: [name.start, match.index + match[0].length] })
	}
	for (const match of text.matchAll(ACRONYM_BEFORE)) {
		const expansion = match[2].trim()
		if (!/\s/.test(expansion) || expansion === expansion.toUpperCase()) continue
		entries.push({ acronym: match[1], expansion, span: [match.index, match.index + match[0].length] })
	}
	return entries
		.sort((a, b) => a.span[0] - b.span[0])
		.map((entry) => ({ acronym: entry.acronym, expansion: entry.expansion, sentence_id: sentenceIdAt(sentences, entry.span[0]), span: entry.span }))
}

function snapshotText(input) {
	if (Array.isArray(input.pages)) return input.pages.join("\f")
	if (typeof input.text === "string") return input.text
	if (typeof input.html === "string") return snapshotFromHtml(input.html)
	throw new TypeError("writeSnapshot needs text, pages, or html")
}

function checkInput(sourceId, input) {
	if (!SOURCE_ID.test(String(sourceId))) throw new TypeError(`source id must be S<n>, got ${sourceId}`)
	if (!EXTRACTOR.test(String(input.extractor))) throw new TypeError(`extractor must be tool:source-snapshot@1, model, or extractor:<name>, got ${input.extractor}`)
	if (typeof (input.url ?? input.path) !== "string") throw new TypeError("writeSnapshot needs a url or a path")
	if (input.kind !== undefined && !KINDS.has(input.kind)) throw new TypeError(`kind must be page, command, or document, got ${input.kind}`)
	if (input.provenance !== undefined && !PROVENANCE.has(input.provenance)) throw new TypeError(`provenance must be primary, secondary, or unknown, got ${input.provenance}`)
}

/**
 * Write <sourcesDir>/<sourceId>/ for one source; returns { dir, sha256 } with sha256 over text.txt.
 * input: { url | path, text | pages | html, extractor, observed_at?, revision?, kind?, provenance? }.
 * Re-writing the same text is a no-op change; a different text over an existing snapshot throws
 * snapshot_exists, because ledger rows pin the old hash.
 */
export function writeSnapshot(sourcesDir, sourceId, input) {
	checkInput(sourceId, input)
	const text = snapshotText(input)
	const sha256 = sha256Of(Buffer.from(text, "utf8"))
	const dir = join(sourcesDir, sourceId)
	const textPath = join(dir, "text.txt")
	if (existsSync(textPath) && sha256Of(readFileSync(textPath)) !== sha256) {
		throw new Error(`snapshot_exists: ${sourceId} already holds a different text.txt`)
	}
	mkdirSync(dir, { recursive: true })
	writeFileSync(textPath, text)
	if (typeof input.html === "string") writeFileSync(join(dir, "source.html"), input.html)
	const meta = {
		source_id: sourceId,
		url: input.url ?? input.path,
		observed_at: input.observed_at ?? new Date().toISOString(),
		sha256,
		extractor: input.extractor,
		revision: input.revision ?? null,
		kind: input.kind ?? (input.url !== undefined || typeof input.html === "string" ? "page" : "document"),
		provenance: input.provenance ?? "unknown",
	}
	writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`)
	const sentences = indexSentences(text, sourceId)
	writeFileSync(join(dir, "sentences.jsonl"), sentences.map((row) => `${JSON.stringify(row)}\n`).join(""))
	const acronyms = { schemaVersion: 1, source_id: sourceId, snapshot_sha256: sha256, entries: findAcronyms(text, sentences) }
	writeFileSync(join(dir, "acronyms.json"), `${JSON.stringify(acronyms, null, 2)}\n`)
	return { dir, sha256 }
}
