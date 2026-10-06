// gates-structure.mjs - structure gates: G11 section without citation, G12 closing section,
// G13 citation section, G14 broken asset reference, G15 required sections.
//
// Each gate is { codes, skip?(ctx), run(ctx) -> Defect[] } over the context built by
// gates-static.mjs. Plain Node ESM, node: builtins and siblings only.

import { join } from "node:path"

import { proseText } from "./html-lite.mjs"

const MIN_SECTION_PROSE = 120
const UNCHECKED_KINDS = new Set(["closing", "sources", "toc", "appendix", "glossary"])
const DEFINITION_TAGS = new Set(["p", "li", "dd", "dt", "td"])
const DEFINITION_LINE = /^\[(S|Source\s*)(\d+)\]/i
const MIN_DEFINITIONS = 3
const NOT_RELATIVE = /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i

function headingNodes(ctx, tags) {
	return ctx.elements.map(({ node }) => node).filter((node) => tags.includes(node.tag))
}

/** Local references an asset gate checks: img src, source srcset, stylesheet href, script src. */
function assetReferences(ctx) {
	const refs = []
	for (const node of ctx.all) {
		const { attrs } = node
		if (node.tag === "img" && attrs.src) refs.push({ node, url: attrs.src })
		else if (node.tag === "script" && attrs.src) refs.push({ node, url: attrs.src })
		else if (node.tag === "link" && attrs.href && /(?:^|\s)stylesheet(?:\s|$)/i.test(attrs.rel ?? "")) refs.push({ node, url: attrs.href })
		else if (node.tag === "source" && attrs.srcset) {
			for (const candidate of attrs.srcset.split(",")) {
				const url = candidate.trim().split(/\s+/)[0]
				if (url) refs.push({ node, url })
			}
		}
	}
	return refs.filter(({ url }) => url.trim() && !NOT_RELATIVE.test(url.trim()))
}

function localPath(baseDir, url) {
	const bare = url.trim().replace(/[?#].*$/, "")
	let decoded = bare
	try {
		decoded = decodeURIComponent(bare)
	} catch {
		// a malformed %-escape is kept verbatim; the stat below reports it as missing
	}
	return join(baseDir, ...decoded.split("/"))
}

function assetProblem(fs, file) {
	try {
		const stat = fs.statSync(file)
		return stat.size === 0 ? "is 0 bytes" : null
	} catch (error) {
		return `is missing (${error?.code ?? "stat failed"})`
	}
}

export const structureGates = [
	{
		codes: ["section_without_citation"],
		run(ctx) {
			const defects = []
			for (const section of ctx.sections) {
				if (UNCHECKED_KINDS.has(section.kind)) continue
				const prose = section.prose.join(" ").replace(/\s+/g, " ").trim()
				if (prose.length < MIN_SECTION_PROSE || section.anchors > 0 || ctx.util.citationMarker.test(prose)) continue
				const title = proseText(section.heading)
				defects.push(ctx.defect("section_without_citation", section.heading, `section "${title}" has ${prose.length} prose characters and no citation marker or anchor`))
			}
			return defects
		},
	},
	{
		codes: ["missing_closing_section"],
		run(ctx) {
			if (headingNodes(ctx, ["h2", "h3"]).some((node) => ctx.isClosing(proseText(node)))) return []
			return [ctx.defect("missing_closing_section", ctx.body, "no h2/h3 heading names how the report was made (method / how)")]
		},
	},
	{
		codes: ["missing_citation_section"],
		run(ctx) {
			if (ctx.sections.some((section) => section.kind === "sources")) return []
			const ids = new Set()
			for (const { node } of ctx.elements) {
				if (!DEFINITION_TAGS.has(node.tag)) continue
				const match = DEFINITION_LINE.exec(proseText(node))
				if (match) ids.add(`${match[1].trim().toLowerCase()}${match[2]}`)
			}
			if (ids.size >= MIN_DEFINITIONS) return []
			return [ctx.defect("missing_citation_section", ctx.body, `no references/sources h2 and ${ids.size} [S<n>] definition line(s) (< ${MIN_DEFINITIONS})`)]
		},
	},
	{
		codes: ["broken_asset_reference"],
		skip: (ctx) => !ctx.baseDir,
		run(ctx) {
			const defects = []
			for (const { node, url } of assetReferences(ctx)) {
				const problem = assetProblem(ctx.fs, localPath(ctx.baseDir, url))
				if (problem) defects.push(ctx.defect("broken_asset_reference", node, `<${node.tag}> asset "${url}" ${problem}`))
			}
			return defects
		},
	},
	{
		codes: ["missing_required_section"],
		skip: (ctx) => ctx.requireSections.length === 0,
		run(ctx) {
			const titles = headingNodes(ctx, ["h1", "h2", "h3", "h4", "h5", "h6"]).map((node) => proseText(node))
			return ctx.requireSections
				.filter((re) => !titles.some((title) => re.test(title)))
				.map((re) => ctx.defect("missing_required_section", ctx.body, `no heading matches the required section ${re}`))
		},
	},
]
