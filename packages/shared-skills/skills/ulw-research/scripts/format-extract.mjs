// format-extract.mjs - read a pointed-at HTML or Markdown document and return the facts a
// design-spec.md draft needs (render with design-spec.renderDesignSpec). Nothing is guessed:
// a value the document does not state is left out, and the renderer writes `TODO: ask`.
//
// Static input only. fetchHtml downloads exactly the given URL with plain fetch; external
// stylesheets are never followed (each is recorded as a note). A page that renders its
// content client-side is the orchestrator's job: render it with the browser skill, save the
// HTML, and pass the saved file. PDF input is rejected with UnsupportedFormatError.
// Plain Node ESM, node: builtins and siblings only.

import { readFileSync } from "node:fs"
import { extname } from "node:path"

import { cssFacts } from "./format-extract-css.mjs"
import { parseHtml, proseText } from "./html-lite.mjs"

export const UNSUPPORTED_MESSAGE = "unsupported: point at the HTML or Markdown source"
export const FETCH_TIMEOUT_MS = 15_000

const S_MARKER = /\[S\d+\]/
const SOURCE_ANCHOR = /\[(?:\uCD9C\uCC98|source(?:\s*\d+)?)\]/i
const LINEAGE_TOKEN = /\b(?:MEASURED|ASSUMED|DERIVED)\b/
const MD_FOOTNOTE = /\[\^[^\]\s]+\]/
const HEADING_NUMBER = /^(\d{1,3}(?:\.\d{1,3})*)\.?(?=\s|$)/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const MD_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
/**
 * @typedef {{ hex: string, count: number, roles: string[] }} ExtractColor
 * @typedef {{
 *   origin: string | undefined, bytes: number,
 *   tokens: { light: Map<string, string>, dark: Map<string, string> },
 *   fonts: { body?: string, heading?: string, mono?: string }, colors: ExtractColor[], breakpoints: number[],
 *   headingNumbering: "double-digit" | "decimal" | "none" | "unknown",
 *   citationStyle: "bracket-S" | "bracket-source" | "footnote" | "unknown",
 *   lineageMode: "inline" | "section" | "unknown", figureContainers: string[],
 *   skeleton: { level: number, text: string }[],
 *   measure: { fontSize?: string, lineHeight?: string, maxWidth?: string }, notes: string[],
 * }} Extract
 */

const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"])
const MD_EXTENSIONS = new Set([".md", ".markdown"])

export class UnsupportedFormatError extends Error {
	constructor(detail) {
		super(UNSUPPORTED_MESSAGE)
		this.name = "UnsupportedFormatError"
		this.code = "unsupported"
		this.detail = detail
	}
}

function rejectPdf(source, origin) {
	if (/\.pdf$/i.test(String(origin ?? ""))) throw new UnsupportedFormatError(`pdf origin: ${origin}`)
	if (String(source).trimStart().startsWith("%PDF-")) throw new UnsupportedFormatError("pdf bytes")
}

/** @returns {Extract} */
function baseExtract(source, origin) {
	return {
		origin,
		bytes: Buffer.byteLength(String(source), "utf8"),
		tokens: { light: new Map(), dark: new Map() },
		fonts: {},
		colors: [],
		breakpoints: [],
		headingNumbering: "unknown",
		citationStyle: "unknown",
		lineageMode: "unknown",
		figureContainers: [],
		skeleton: [],
		measure: {},
		notes: [],
	}
}

/** h2 numbers ("01", "1.2", or null) -> double-digit when every numbered h2 uses two digits. */
function classifyNumbering(numbers) {
	if (!numbers.length) return "unknown"
	const numbered = numbers.filter(Boolean)
	if (numbered.length * 2 < numbers.length) return "none"
	return numbered.every((number) => /^\d{2}$/.test(number)) ? "double-digit" : "decimal"
}

function headingNumber(text) {
	return HEADING_NUMBER.exec(text)?.[1] ?? null
}

function citationFacts(text, hasFootnotes, hasLineageAttribute) {
	const style = S_MARKER.test(text) ? "bracket-S" : SOURCE_ANCHOR.test(text) ? "bracket-source" : hasFootnotes ? "footnote" : "unknown"
	let lineage = "unknown"
	if (hasLineageAttribute || LINEAGE_TOKEN.test(text) || S_MARKER.test(text)) lineage = "inline"
	else if (SOURCE_ANCHOR.test(text)) lineage = "section"
	return { style, lineage }
}

function walk(node, visit) {
	for (const child of node.children) {
		visit(child)
		walk(child, visit)
	}
}

function classesOf(node) {
	return String(node.attrs.class ?? "").split(/\s+/).filter(Boolean)
}

/** Previous element sibling whose whole text is a heading number (a `.sec-no` style eyebrow). */
function eyebrowNumber(heading) {
	const siblings = heading.parent.children.filter((child) => child.tag !== "#text" || child.text.trim())
	const previous = siblings[siblings.indexOf(heading) - 1]
	if (!previous || previous.tag === "#text" || /^h[1-6]$/.test(previous.tag)) return null
	const text = proseText(previous)
	return HEADING_NUMBER.test(text) && headingNumber(text) === text.replace(/\.$/, "") ? headingNumber(text) : null
}

/** Nearest `<figure>` or fig/chart-classed ancestor of an img or svg. */
function figureContainer(node) {
	for (let cur = node.parent; cur && cur.tag !== "body"; cur = cur.parent) {
		const classes = classesOf(cur)
		if (cur.tag === "figure" || classes.some((name) => /fig|chart/i.test(name))) return cur
	}
	return null
}

function rankByCount(names) {
	const counts = new Map()
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
	return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}

/** @returns {Extract} throws UnsupportedFormatError on PDF input. */
export function extractFromHtml(source, { origin } = {}) {
	rejectPdf(source, origin)
	const extract = baseExtract(source, origin)
	const root = parseHtml(source)
	const styles = []
	const headings = []
	const containers = []
	let hasFootnotes = false
	let hasLineageAttribute = false
	let scripts = 0
	walk(root, (node) => {
		if (node.tag === "style") styles.push(node.raw ?? "")
		else if (node.tag === "script") scripts++
		else if (node.tag === "link" && /(?:^|\s)stylesheet(?:\s|$)/i.test(node.attrs.rel ?? "")) {
			extract.notes.push(`skipped external stylesheet: ${node.attrs.href ?? "(no href)"}`)
		} else if (/^h[1-6]$/.test(node.tag)) headings.push(node)
		else if (node.tag === "img" || node.tag === "svg") {
			const container = figureContainer(node)
			if (container) containers.push(...classesOf(container))
		} else if (node.tag === "sup" && node.children.some((child) => child.tag === "a" && /^#/.test(child.attrs.href ?? ""))) hasFootnotes = true
		else if (node.attrs?.role === "doc-noteref") hasFootnotes = true
		if (node.attrs && Object.hasOwn(node.attrs, "data-lineage")) hasLineageAttribute = true
	})
	const css = styles.join("\n")
	for (const match of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) extract.notes.push(`skipped @import: ${match[1]}`)
	if (styles.length > 1) extract.notes.push(`${styles.length} <style> blocks concatenated`)
	if (css.trim()) Object.assign(extract, cssFacts(css))
	if (!extract.fonts.heading && extract.fonts.body) extract.notes.push("no heading font-family rule; headings inherit the body stack")

	const body = root.children.find((child) => child.tag === "html")?.children.find((child) => child.tag === "body")
		?? root.children.find((child) => child.tag === "body")
		?? root
	const text = proseText(body)
	if (scripts && text.length < 200) {
		extract.notes.push(`little static text with ${scripts} <script> tags: if the page renders client-side, render it with the browser skill and pass the saved HTML`)
	}
	const citation = citationFacts(text, hasFootnotes, hasLineageAttribute)
	extract.citationStyle = citation.style
	extract.lineageMode = citation.lineage
	const h2 = headings.filter((node) => node.tag === "h2")
	extract.headingNumbering = classifyNumbering(h2.map((node) => headingNumber(proseText(node)) ?? eyebrowNumber(node)))
	extract.skeleton = headings
		.filter((node) => node.tag === "h1" || node.tag === "h2")
		.map((node) => ({ level: Number(node.tag[1]), text: proseText(node) }))
	extract.figureContainers = rankByCount(containers)
	return extract
}

/** Markdown carries structure only: skeleton, heading numbering, citation style. @returns {Extract} */
export function extractFromMarkdown(source, { origin } = {}) {
	rejectPdf(source, origin)
	const extract = baseExtract(source, origin)
	const prose = []
	let fence = null
	for (const line of String(source).split(/\r?\n/)) {
		const fenceMatch = FENCE.exec(line)
		if (fence) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) fence = null
			continue
		}
		if (fenceMatch) {
			fence = fenceMatch[1]
			continue
		}
		prose.push(line.replace(/`[^`]*`/g, ""))
		const heading = MD_HEADING.exec(line)
		if (heading && heading[1].length <= 2) extract.skeleton.push({ level: heading[1].length, text: heading[2] })
	}
	const text = prose.join("\n")
	extract.citationStyle = citationFacts(text, MD_FOOTNOTE.test(text), false).style
	extract.headingNumbering = classifyNumbering(extract.skeleton.filter((entry) => entry.level === 2).map((entry) => headingNumber(entry.text)))
	extract.notes.push("markdown source: tokens, fonts, colors, breakpoints, figures, and measure are not carried by Markdown")
	return extract
}

/** Dispatch on the file extension: .html/.htm/.xhtml, .md/.markdown; anything else (PDF included) is unsupported. @returns {Extract} */
export function extractFromPath(filePath) {
	const extension = extname(filePath).toLowerCase()
	if (HTML_EXTENSIONS.has(extension)) return extractFromHtml(readFileSync(filePath, "utf8"), { origin: filePath })
	if (MD_EXTENSIONS.has(extension)) return extractFromMarkdown(readFileSync(filePath, "utf8"), { origin: filePath })
	throw new UnsupportedFormatError(`extension ${extension || "(none)"}: ${filePath}`)
}

/** GET exactly `url` (plain fetch, 15 s timeout, no browser) and return the body text. */
export async function fetchHtml(url) {
	if (/\.pdf$/i.test(new URL(url).pathname)) throw new UnsupportedFormatError(`pdf url: ${url}`)
	const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
	const type = response.headers.get("content-type") ?? ""
	if (!response.ok || /pdf/i.test(type)) {
		await response.body?.cancel()
		if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status} for ${url}`)
		throw new UnsupportedFormatError(`pdf response: ${url}`)
	}
	const text = await response.text()
	if (text.trimStart().startsWith("%PDF-")) throw new UnsupportedFormatError(`pdf bytes: ${url}`)
	return text
}
