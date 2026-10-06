// gates-static.mjs - deterministic static gates (G1-G15) over a parsed report.
//
// Builds one document context (a document-order walk with h2 sections, citation helpers and a
// defect factory) and hands it to the text, figure and structure gate modules. Every severity
// comes from contracts.DEFECT_CODES; the single override is unsourced_number under
// `Lineage: section`, derived from the spec mode passed in, never from a caller-supplied
// severity. Plain Node ESM, node: builtins and siblings only.

import * as nodeFs from "node:fs"

import { DEFECT_CODES, LINEAGE_MODES } from "./contracts.mjs"
import { customProperties } from "./css-lite.mjs"
import { figureGates } from "./gates-figures.mjs"
import { structureGates } from "./gates-structure.mjs"
import { textGates } from "./gates-text.mjs"
import { PROSE_TAGS, proseText, selectorPath } from "./html-lite.mjs"

const CITATION_MARKER = /\[S\d+\]|\[Source\s*\d+\]|\[\uCD9C\uCC98[^\]]*\]|\[\^\d+\]/i
const ANCHOR_HREF = /^#(?:s|src|source|ref|fn)/i
const ANCHOR_TEXT = /^\[(?:\uCD9C\uCC98|Source\s*\d+|S\d+)\]$/i
/** Closing ("how this report was made") heading; Korean alternates cover the same register. */
export const CLOSING_HEADING = /\b(?:method(?:ology)?|how)\b|\uB4B7\uBA74|\uBC29\uBC95|\uC5B4\uB5BB\uAC8C|\uB9CC\uB4E4\uC5B4/i
export const SOURCES_HEADING = /references|sources|bibliography|\uCD9C\uCC98|\uCC38\uACE0\s*(?:\uBB38\uD5CC|\uC790\uB8CC)/i
const OTHER_KINDS = [
	["toc", /\b(?:contents|toc)\b|\uBAA9\uCC28/i],
	["appendix", /appendix|\uBD80\uB85D/i],
	["glossary", /glossary|\uC6A9\uC5B4/i],
]
const TEXT_SKIP = new Set(["code", "pre", "kbd", "samp", "script", "style", "svg", "template", "noscript"])
const HEADING_TAG = /^h[1-6]$/
/** The one sanctioned severity override: section-level lineage demotes unsourced_number. */
const SECTION_LINEAGE_SEVERITY = "minor"

const GATES = [...textGates, ...figureGates, ...structureGates]

function classTokens(node) {
	return String(node.attrs.class ?? "").toLowerCase().split(/\s+/).filter(Boolean)
}

function closest(node, predicate) {
	for (let cur = node.parent; cur; cur = cur.parent) if (predicate(cur)) return cur
	return null
}

function descendants(node, out = []) {
	for (const child of node.children) {
		if (child.tag === "#text") continue
		out.push(child)
		descendants(child, out)
	}
	return out
}

function isCitationAnchor(node) {
	return node.tag === "a" && (ANCHOR_HREF.test(node.attrs.href ?? "") || ANCHOR_TEXT.test(proseText(node)))
}

/** A citation marker in the element's prose or a citation anchor below it. */
function hasCitation(node) {
	return CITATION_MARKER.test(proseText(node)) || descendants(node).some(isCitationAnchor)
}

function toRegExp(pattern) {
	const re = pattern instanceof RegExp ? pattern : new RegExp(String(pattern), "i")
	return new RegExp(re.source, re.flags.replace(/[gy]/g, ""))
}

function findBody(doc) {
	const stack = [doc]
	while (stack.length) {
		const node = stack.pop()
		if (node.tag === "body") return node
		for (const child of node.children) if (child.tag !== "#text") stack.push(child)
	}
	return doc
}

function sectionKind(text, closingTest) {
	if (SOURCES_HEADING.test(text)) return "sources"
	if (closingTest(text)) return "closing"
	return OTHER_KINDS.find(([, re]) => re.test(text))?.[0] ?? null
}

/** Document-order walk of body: element scopes, prose text entries with owners, h2 sections. */
function walkBody(ctx, node, state) {
	for (const child of node.children) {
		if (child.tag === "#text") {
			if (state.skip) continue
			ctx.texts.push({ node: child, owner: state.owner ?? node, cell: state.cell, scope: ctx.scope })
			if (ctx.scope.section && !state.heading) ctx.scope.section.prose.push(child.text)
			continue
		}
		if (child.tag === "h2") {
			const section = { heading: child, kind: sectionKind(proseText(child), ctx.isClosing), prose: [], anchors: 0 }
			ctx.sections.push(section)
			ctx.scope = { section, closingH3: false }
		} else if (child.tag === "h3") {
			ctx.scope = { section: ctx.scope.section, closingH3: ctx.isClosing(proseText(child)) }
		}
		ctx.elements.push({ node: child, scope: ctx.scope })
		if (ctx.scope.section && isCitationAnchor(child)) ctx.scope.section.anchors++
		walkBody(ctx, child, {
			skip: state.skip || TEXT_SKIP.has(child.tag),
			owner: PROSE_TAGS.has(child.tag) ? child : state.owner,
			cell: state.cell || child.tag === "td" || child.tag === "th",
			heading: state.heading || HEADING_TAG.test(child.tag),
		})
	}
}

function buildContext(doc, options) {
	const lineageMode = options.lineageMode ?? "inline"
	if (!LINEAGE_MODES.includes(lineageMode)) throw new TypeError(`lineageMode must be one of ${LINEAGE_MODES.join(", ")}`)
	const closingPattern = options.closingPattern ? toRegExp(options.closingPattern) : null
	const all = descendants(doc)
	const styleBlocks = all.filter((node) => node.tag === "style").map((node) => ({ node, css: node.raw ?? "" }))
	const styleAttrs = all.filter((node) => node.attrs.style).map((node) => ({ node, css: node.attrs.style }))
	const ctx = {
		doc,
		body: findBody(doc),
		all,
		elements: [],
		texts: [],
		sections: [],
		scope: { section: null, closingH3: false },
		styleBlocks,
		styleAttrs,
		tokens: customProperties(styleBlocks.map((entry) => entry.css).join("\n")).light,
		palette: new Set(options.palette ?? []),
		requireSections: (options.requireSections ?? []).map(toRegExp),
		baseDir: options.baseDir ?? null,
		fs: options.fs ?? nodeFs,
		isClosing: (text) => CLOSING_HEADING.test(text) || Boolean(closingPattern?.test(text)),
		util: { classTokens, closest, descendants, hasCitation, citationMarker: CITATION_MARKER },
		kindOf: (scope) => (scope.closingH3 ? "closing" : (scope.section?.kind ?? null)),
		defect(code, node, message) {
			const entry = DEFECT_CODES[code]
			const severity = code === "unsourced_number" && lineageMode === "section" ? SECTION_LINEAGE_SEVERITY : entry.severity
			return { code, severity, selector: selectorPath(node) || node.tag, line: node.line, message, hint: entry.hint }
		},
	}
	walkBody(ctx, ctx.body, { skip: false, owner: null, cell: false, heading: false })
	return ctx
}

/**
 * Run G1-G15 over a parsed report (html-lite root).
 * @param {object} doc parseHtml(...) result
 * @param {{ palette?: Set<string>, lineageMode?: "inline"|"section", requireSections?: (RegExp|string)[],
 *   baseDir?: string, fs?: { statSync(path: string): { size: number } }, closingPattern?: RegExp|string }} options
 * @returns {{ defects: object[], gatesRun: string[], gatesSkipped: string[] }}
 */
export function checkStatic(doc, options = {}) {
	const ctx = buildContext(doc, options)
	const defects = []
	const gatesRun = []
	const gatesSkipped = []
	for (const gate of GATES) {
		if (gate.skip?.(ctx)) {
			gatesSkipped.push(...gate.codes)
			continue
		}
		gatesRun.push(...gate.codes)
		defects.push(...gate.run(ctx))
	}
	return { defects, gatesRun, gatesSkipped }
}
