// css-hiding.mjs - whether CSS hides an element of a page from every reader, from its inline style and
// the page's own <style> rules (external stylesheets and scripts are not evaluated).
//
// Text counts as reader-visible when it is visible under at least one condition. So a rule can hide
// only when it certainly applies: it sits outside every at-rule except @layer (and @media all), its
// <style> element applies everywhere (no media other than all, CSS type, not in <noscript>), and its
// selector is one tag (case-insensitive), one .class or one #id (case-sensitive). A rule that only
// might apply (inside @media, @supports, @container, @scope, @starting-style, @document, @keyframes,
// nested in another style rule, or with a compound, combinator, attribute or pseudo-class selector)
// never hides, but it can make text visible when its subject could match and it outranks the hiding
// declaration in the cascade (origin and importance, inline style, layer order, specificity, order).
// Hiding properties: display:none and content-visibility:hidden remove the subtree;
// visibility:hidden|collapse is inherited and a descendant's visibility:visible shows it again.
// The hidden attribute (except hidden="until-found") and a closed <dialog> are the user-agent
// display:none, which any author display declaration overrides. opacity, clip, zero size, font-size,
// off-screen positions and colors do not hide: the text still renders or is read aloud.
// Plain Node ESM, sibling imports only.

import { scanRules } from "./css-lite.mjs"

const PROPS = new Set(["display", "visibility", "content-visibility"])
const INHERITED = new Set(["inherit", "unset", "revert", "revert-layer"])
const IMPORTANT = /!\s*important\s*$/i
const SIMPLE = /^(?:[.#][^\s.#:[\]>+~,()*"'\\]+|[a-z][a-z0-9-]*)$/iu
const PSEUDO_ELEMENT = /::|:(?:before|after|first-line|first-letter)\b/i
const NAME = "[^\\s.#:[\\]>+~,()*\"'\\\\]+"
const STYLE_IN_SVG = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi

/** [tier (0 user agent, 1 author, 2 author !important), inline, layer, specificity, order]: higher wins. */
const outranks = (a, b) => {
	for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k]
	return false
}

function specificity(selector) {
	const core = selector.replace(/\[[^\]]*\]/g, " [] ")
	const ids = core.match(new RegExp(`#${NAME}`, "gu"))?.length ?? 0
	const classes = (core.match(new RegExp(`\\.${NAME}`, "gu"))?.length ?? 0) + (core.match(/\[\]|:(?!:)[\w-]+/g)?.length ?? 0)
	const tags = core.match(/(?:^|[\s>+~(])[a-z][\w-]*/gi)?.length ?? 0
	return ids * 10000 + classes * 100 + tags
}

/** The subject compound of a selector: its tag, classes and ids (attribute and pseudo-class parts dropped). */
function subject(selector) {
	const compound = selector.trim().match(/(?:[^\s>+~[\]()]|\[[^\]]*\]|\([^)]*\))+$/)?.[0] ?? ""
	const core = compound.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/:+[\w-]+/g, "")
	const tag = core.match(/^[a-z][a-z0-9-]*/i)?.[0].toLowerCase() ?? null
	const classes = [...core.matchAll(new RegExp(`\\.(${NAME})`, "gu"))].map((match) => match[1])
	const ids = [...core.matchAll(new RegExp(`#(${NAME})`, "gu"))].map((match) => match[1])
	return { tag, classes, ids, key: ids[0] ? `#${ids[0]}` : classes[0] ? `.${classes[0]}` : tag ?? "*" }
}

const classList = (node) => String(node.attrs?.class ?? "").split(/[ \t\n\f\r]+/).filter(Boolean)

function matches(sub, node) {
	if (sub.tag !== null && sub.tag !== node.tag) return false
	const names = classList(node)
	return sub.classes.every((name) => names.includes(name)) && sub.ids.every((id) => id === node.attrs?.id)
}

/** Whether every enclosing at-rule leaves the rule unconditional (@layer, @media all), its layer name, and keyframe steps. */
function context(atRule) {
	const entries = atRule ? atRule.split(/\s(?=@)/) : []
	const layers = entries.filter((entry) => /^@layer\b/i.test(entry)).map((entry) => entry.slice(6).trim())
	const conditional = entries.some((entry) => !/^@layer\b/i.test(entry) && !/^@media(?:\s+all)?\s*$/i.test(entry))
	return { conditional, layer: layers.length ? layers.join(".") : null, keyframe: entries.some((entry) => /^@(?:-[a-z]+-)?keyframes\b/i.test(entry)) }
}

const declaration = (value) => ({ value: value.replace(IMPORTANT, "").trim().toLowerCase(), important: IMPORTANT.test(value) })

/** Every <style> text that applies to the page, with whether it applies only under a condition. */
function sheets(root) {
	const found = []
	const visit = (node, conditional) => {
		if (node.tag === "template") return
		const inner = conditional || node.tag === "noscript"
		if (node.tag === "style") {
			const type = String(node.attrs?.type ?? "").trim().toLowerCase()
			const media = String(node.attrs?.media ?? "").trim().toLowerCase()
			if (type === "" || type === "text/css") found.push({ css: String(node.raw ?? ""), conditional: inner || (media !== "" && media !== "all") })
		}
		if (node.tag === "svg") for (const match of String(node.raw ?? "").matchAll(STYLE_IN_SVG)) found.push({ css: match[1], conditional: inner })
		for (const child of node.children ?? []) visit(child, inner)
	}
	visit(root, false)
	return found
}

/** Index every rule declaring display, visibility or content-visibility by its subject key. */
function indexRules(root) {
	const index = new Map()
	const layers = []
	const layerRank = (name, important) => {
		if (name === null) return important ? -1 : 1e6
		if (!layers.includes(name)) layers.push(name)
		return important ? 1e6 - layers.indexOf(name) : layers.indexOf(name)
	}
	let order = 0
	for (const sheet of sheets(root)) {
		const css = sheet.css.replace(/<!--|-->/g, " ")
		for (const match of css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "").matchAll(/@layer\s+([^{;]*)[{;]/gi)) {
			for (const name of match[1].split(",").map((part) => part.trim())) if (name && !layers.includes(name)) layers.push(name)
		}
		for (const rule of scanRules(css)) {
			const decls = rule.declarations.filter((entry) => PROPS.has(entry.prop))
			if (!decls.length || rule.selector.startsWith("@")) continue
			const { conditional, layer, keyframe } = context(rule.atRule)
			if (keyframe) continue
			for (const selector of rule.selector.split(/,(?![^()[\]]*[)\]])/).map((part) => part.trim())) {
				if (!selector || PSEUDO_ELEMENT.test(selector)) continue
				const sub = subject(selector)
				const certain = !sheet.conditional && !conditional && !rule.nested && SIMPLE.test(selector)
				const spec = specificity(selector)
				for (const entry of decls) {
					const { value, important } = declaration(entry.value)
					const rank = [important ? 2 : 1, 0, layerRank(layer, important), spec, order++]
					if (!index.has(sub.key)) index.set(sub.key, [])
					index.get(sub.key).push({ sub, prop: entry.prop, value, rank, certain })
				}
			}
		}
	}
	return index
}

/** The values a property can take on the element: the certain winner, plus every possible rule that outranks it. */
function possible(candidates, prop) {
	let top = null
	for (const entry of candidates) if (entry.prop === prop && entry.certain && (top === null || outranks(entry.rank, top.rank))) top = entry
	const values = [top === null ? "unset" : top.value]
	for (const entry of candidates) if (entry.prop === prop && !entry.certain && (top === null || outranks(entry.rank, top.rank))) values.push(entry.value)
	return values
}

/**
 * cssVisibility(root) -> (node, parentShown) => null when CSS removes the element and its subtree from every
 * rendering, else whether its own text can be seen (visibility, inherited from parentShown).
 */
export function cssVisibility(root) {
	const index = indexRules(root)
	return (node, parentShown) => {
		const attrs = node.attrs ?? {}
		const keys = ["*", node.tag, ...classList(node).map((name) => `.${name}`), attrs.id === undefined ? null : `#${attrs.id}`]
		const candidates = []
		for (const key of new Set(keys)) for (const entry of index.get(key) ?? []) if (matches(entry.sub, node)) candidates.push(entry)
		const hiddenAttr = attrs.hidden !== undefined && String(attrs.hidden).trim().toLowerCase() !== "until-found"
		if (hiddenAttr || (node.tag === "dialog" && attrs.open === undefined)) candidates.push({ prop: "display", value: "none", rank: [0, 0, 0, 0, -1], certain: true })
		const inline = attrs.style ? (scanRules(`x{${attrs.style}}`)[0]?.declarations ?? []) : []
		inline.forEach((entry, at) => {
			if (!PROPS.has(entry.prop)) return
			const { value, important } = declaration(entry.value)
			candidates.push({ prop: entry.prop, value, rank: [important ? 2 : 1, 1, 0, 0, at], certain: true })
		})
		if (possible(candidates, "display").every((value) => value === "none")) return null
		if (possible(candidates, "content-visibility").every((value) => value === "hidden")) return null
		return possible(candidates, "visibility").some((value) => (INHERITED.has(value) ? parentShown : value !== "hidden" && value !== "collapse"))
	}
}
