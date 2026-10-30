// source-snapshot.mjs - the per-source snapshot that fact locators read.
//
// writeSnapshot writes <sourcesDir>/<S-id>/ with raw.bin (the fetched or captured bytes, absent
// only for converted-only sources), meta.json (sha256 of the pinned body, text_source, charset),
// text.txt (the locator text of source-view.mjs: the visible text nodes of a page, the decoded
// bytes of a document, or a declared/converted extraction), source.html for pages (decoded, a
// reading aid), sentences.jsonl (sid S<n>:s<k>, indexed over text.txt) and acronyms.json; a page
// also gets conversion.json, the conversion probe's record of the numbers its text.txt altered.
// Plain Node ESM, node: builtins and sibling imports only.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { probeConversion } from "./conversion-probe.mjs"
import { writeFidelityRecord } from "./fidelity-records.mjs"
import { extractHtml } from "./html-text-map.mjs"
import { splitSentences } from "./sentence-split.mjs"
import { buildView } from "./source-view.mjs"

const SOURCE_ID = /^S[1-9]\d*$/
const EXTRACTOR = /^(?:tool:source-snapshot@1|model|extractor:[\w.@+-]+)$/
const KINDS = new Set(["page", "command", "document", "converted-only"])
const PROVENANCE = new Set(["primary", "secondary", "unknown"])
const ACRONYM_AFTER = /\(([A-Z]{2,6})\)/g
const ACRONYM_BEFORE = /(?<![\p{L}\p{N}])([A-Z]{2,6})\s?\(([A-Z][^()\n]{2,79})\)/gu
const NAME_WORD = /^[A-Z][\p{L}\p{N}-]*$/u
const CONNECTOR = new Set(["of", "and", "for", "the", "in", "on", "to", "&"])
const MARKUP = /^\s*</

/**
 * Block lines of a page: { root, text, blocks: [{ node, start, end }], starts, ends } where text
 * joins the visible block texts with "\n" (html-text-map.mjs). fact-locate reads cells through `node`.
 */
export function snapshotBlocks(html) {
	return extractHtml(html)
}

/** text.txt form of an html page. */
export function snapshotFromHtml(html) {
	return extractHtml(html).text
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
	throw new TypeError("writeSnapshot needs raw, html, text, or pages")
}

/** Which source-view text source the input makes, with the bytes it pins. */
function bodiesOf(input) {
	if (input.kind === "converted-only") return { mode: "converted", raw: null, textBody: Buffer.from(snapshotText(input)) }
	if (input.declared === true) return { mode: "declared", raw: Buffer.from(input.raw), textBody: Buffer.from(snapshotText(input)) }
	if (input.raw === undefined && typeof input.html === "string") return { mode: "html", raw: Buffer.from(input.html), textBody: null }
	if (input.raw === undefined) return { mode: "decoded", raw: Buffer.from(snapshotText(input)), textBody: null }
	const raw = Buffer.from(input.raw)
	if (input.markup === true || typeof input.html === "string" || input.kind === "page" || MARKUP.test(raw.subarray(0, 1024).toString("latin1").replace(/^\u00ef\u00bb\u00bf/, ""))) return { mode: "html", raw, textBody: null }
	if (input.text !== undefined || input.pages !== undefined) return { mode: "declared", raw, textBody: Buffer.from(snapshotText(input)) }
	return { mode: "decoded", raw, textBody: null }
}

function checkInput(sourceId, input) {
	if (!SOURCE_ID.test(String(sourceId))) throw new TypeError(`source id must be S<n>, got ${sourceId}`)
	if (!EXTRACTOR.test(String(input.extractor))) throw new TypeError(`extractor must be tool:source-snapshot@1, model, or extractor:<name>, got ${input.extractor}`)
	if (typeof (input.url ?? input.path) !== "string") throw new TypeError("writeSnapshot needs a url or a path")
	if (input.kind !== undefined && !KINDS.has(input.kind)) throw new TypeError(`kind must be page, command, document, or converted-only, got ${input.kind}`)
	if (input.provenance !== undefined && !PROVENANCE.has(input.provenance)) throw new TypeError(`provenance must be primary, secondary, or unknown, got ${input.provenance}`)
	if (input.observed_at !== undefined && (typeof input.observed_at !== "string" || Number.isNaN(new Date(input.observed_at).getTime()))) throw new TypeError(`observed_at must be an ISO timestamp, got ${input.observed_at}`)
}

function pinnedHash(dir) {
	const metaPath = join(dir, "meta.json")
	return existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")).sha256 : null
}

/**
 * Write <sourcesDir>/<sourceId>/ for one source; returns { dir, sha256, altered } over the pinned body,
 * where altered lists the numbers the page conversion altered (null when no page conversion ran).
 * input: { url | path, raw?, markup?, html?, text? | pages?, charset?, extractor, observed_at?, revision?,
 * kind?, provenance? } (see bodiesOf). Re-writing the same bytes is a no-op; different bytes over
 * an existing snapshot throw snapshot_exists, because ledger rows pin the old hash, unless
 * options.replace (`source refresh`, which re-anchors those rows, or `source snapshot --replace`, which
 * has checked that no active row pins it) is set; a replacement drops the old capture's command.json.
 */
export function writeSnapshot(sourcesDir, sourceId, input, options = {}) {
	checkInput(sourceId, input)
	const { mode, raw, textBody } = bodiesOf(input)
	const view = buildView(mode, { raw, textBody, charset: input.charset ?? null })
	const sha256 = sha256Of(raw ?? textBody)
	const dir = join(sourcesDir, sourceId)
	const pinned = pinnedHash(dir)
	if (pinned !== null && pinned !== sha256) {
		if (options.replace !== true) throw new Error(`snapshot_exists: ${sourceId} already holds different snapshot bytes`)
		rmSync(join(dir, "command.json"), { force: true })
	}
	mkdirSync(dir, { recursive: true })
	if (raw) writeFileSync(join(dir, "raw.bin"), raw)
	else rmSync(join(dir, "raw.bin"), { force: true })
	writeFileSync(join(dir, "text.txt"), textBody ?? view.text)
	if (view.html !== null) writeFileSync(join(dir, "source.html"), view.html)
	else rmSync(join(dir, "source.html"), { force: true })
	const meta = {
		source_id: sourceId,
		url: input.url ?? input.path,
		observed_at: input.observed_at ?? new Date().toISOString(),
		sha256,
		extractor: input.extractor,
		revision: input.revision ?? null,
		kind: input.kind ?? (input.url !== undefined || mode === "html" ? "page" : "document"),
		provenance: input.provenance ?? "unknown",
		text_source: mode,
		...(raw ? { charset: view.encoding } : {}),
		...(mode === "declared" ? { text_sha256: sha256Of(textBody) } : {}),
	}
	writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`)
	let altered = null
	if (mode === "html") {
		const { altered: changed, ...counts } = probeConversion(view.html, view.text, { attributes: false })
		altered = changed
		writeFidelityRecord(join(dir, "conversion.json"), "source_conversion", {
			artifact_sha256: sha256Of(view.html), report: join(dir, "source.html"), defects: [],
			conversion_altered_numbers: changed, ...counts,
		}, new Date(meta.observed_at))
	} else rmSync(join(dir, "conversion.json"), { force: true })
	const sentences = indexSentences(view.text, sourceId)
	writeFileSync(join(dir, "sentences.jsonl"), sentences.map((row) => `${JSON.stringify(row)}\n`).join(""))
	const acronyms = { schemaVersion: 1, source_id: sourceId, snapshot_sha256: sha256, entries: findAcronyms(view.text, sentences) }
	writeFileSync(join(dir, "acronyms.json"), `${JSON.stringify(acronyms, null, 2)}\n`)
	return { dir, sha256, altered }
}
