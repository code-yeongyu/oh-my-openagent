// source-view.mjs - the one reading of a source snapshot that locators, verify, and refresh share.
//
// A snapshot's meta.json `text_source` says where its locator text comes from:
//   html      - text nodes of raw.bin (html-text-map.mjs), offsets are raw.bin bytes
//   decoded   - raw.bin decoded in its charset, offsets are raw.bin bytes
//   declared  - text.txt is a declared extraction (--raw + --text) of non-HTML raw.bin; offsets
//               are text.txt bytes, and raw.bin and text.txt are both pinned
//   converted - converted-only: no raw.bin, text.txt is all there is (quotes only)
// A snapshot without text_source and without raw.bin is a legacy text.txt snapshot. byteSpan maps
// a [start, end) range of `text` to [startByte, endByte) in `artifact`, never through a re-encode.
// node: builtins and sibling imports only.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { extractHtml } from "./html-text-map.mjs"
import { decodeRaw } from "./raw-decode.mjs"

export const TEXT_SOURCES = Object.freeze(["html", "decoded", "declared", "converted"])

/** Read one snapshot file; the error names the file and the cause (missing, EACCES, ...). */
export function readPart(dir, name, encoding) {
	try {
		return readFileSync(join(dir, name), encoding)
	} catch (error) {
		const cause = error.code === "ENOENT" ? "is missing" : error.code === "EISDIR" ? "is not a readable file" : `is unreadable (${error.code ?? error.message})`
		throw Object.assign(new Error(`${name} ${cause}`), { code: error.code, part: name })
	}
}

/** The text source a meta.json declares, inferring it for snapshots written before the field. */
export function textSourceOf(meta, hasRaw) {
	if (TEXT_SOURCES.includes(meta.text_source)) return meta.text_source
	if (!hasRaw) return meta.kind === "converted-only" ? "converted" : "legacy"
	return meta.kind === "page" ? "html" : "decoded"
}

/**
 * Locator text and byte map for one snapshot body. raw is raw.bin (null for converted/legacy),
 * textBody is text.txt bytes (needed for declared, converted, legacy).
 */
export function buildView(mode, { raw = null, textBody = null, charset = null }) {
	if (mode === "html") {
		const decoded = decodeRaw(raw, charset, true)
		const map = extractHtml(decoded.text)
		const byteSpan = (start, end) => {
			if (end <= start) return [decoded.bytes[map.ends[start - 1] ?? 0], decoded.bytes[map.ends[start - 1] ?? 0]]
			return [decoded.bytes[map.starts[start]], decoded.bytes[map.ends[end - 1]]]
		}
		return { mode, artifact: "raw.bin", encoding: decoded.encoding, text: map.text, html: decoded.text, root: map.root, blocks: map.blocks, byteSpan }
	}
	if (mode === "legacy") return { mode, artifact: "text.txt", encoding: "utf-8", text: Buffer.from(textBody).toString("utf8"), html: null, root: null, blocks: null, byteSpan: null }
	const body = mode === "decoded" ? raw : textBody
	const decoded = decodeRaw(body, mode === "decoded" ? charset : "utf-8")
	const byteSpan = (start, end) => [decoded.bytes[start], decoded.bytes[Math.max(start, end)]]
	return { mode, artifact: mode === "decoded" ? "raw.bin" : "text.txt", encoding: decoded.encoding, text: decoded.text, html: null, root: null, blocks: null, byteSpan }
}

/**
 * Read and hash a snapshot directory. Throws (with the file and cause) when meta.json, raw.bin, or
 * text.txt cannot be read; hash drift is returned, not thrown: { meta, view, raw, sha256, drift }.
 * sha256 is the hash of the pinned body (raw.bin, or text.txt for converted and legacy snapshots).
 */
export function readSnapshot(dir) {
	let meta
	try {
		meta = JSON.parse(readPart(dir, "meta.json", "utf8"))
	} catch (error) {
		throw error.part ? error : new Error("meta.json is not valid JSON")
	}
	if (meta === null || typeof meta !== "object" || typeof meta.sha256 !== "string") throw new Error("has invalid snapshot metadata (meta.json has no sha256)")
	let raw = null
	if (meta.text_source === undefined) {
		try {
			raw = readPart(dir, "raw.bin")
		} catch (error) {
			if (error.code !== "ENOENT") throw error
		}
	}
	const mode = textSourceOf(meta, raw !== null)
	if (raw === null && ["html", "decoded", "declared"].includes(mode)) raw = readPart(dir, "raw.bin")
	const textBody = ["declared", "converted", "legacy"].includes(mode) ? readPart(dir, "text.txt") : null
	const sha256 = sha256Of(raw ?? textBody)
	const drift = []
	if (sha256 !== meta.sha256) drift.push(`hash mismatch: ${raw ? "raw.bin" : "text.txt"} changed after its snapshot was pinned`)
	if (mode === "declared" && sha256Of(textBody) !== meta.text_sha256) drift.push("hash mismatch: text.txt (the declared extraction) changed after it was pinned")
	return { meta, raw, sha256, drift, view: buildView(mode, { raw, textBody, charset: meta.charset ?? null }) }
}
