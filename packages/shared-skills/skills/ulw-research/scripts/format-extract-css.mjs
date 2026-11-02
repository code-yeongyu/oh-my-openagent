// format-extract-css.mjs - the CSS half of format-extract: tokens, font stacks, ranked colors,
// breakpoints, and the reading measure. Only values the stylesheet states are returned; a
// missing value stays undefined so the renderer writes `TODO: ask`.
// Plain Node ESM, node: builtins and siblings only.

import { customProperties, fontFamilies, hexColors, mediaBreakpoints, resolveVar, scanRules } from "./css-lite.mjs"

const ROLE_ORDER = ["body", "heading", "link", "background", "border", "accent"]
const TOP_COLORS = 8
const ABSOLUTE_LENGTH = /^\d+(?:\.\d+)?(?:px|rem|em|ch)$/i

/** Last compound of each comma-separated selector part, pseudo-classes and attributes dropped. */
function subjects(selector) {
	return selector.split(",").map((part) => {
		const compounds = part.trim().split(/\s*[\s>+~]\s*/)
		return (compounds.at(-1) ?? "").replace(/(?:::?[\w-]+(?:\([^)]*\))?|\[[^\]]*\])+$/g, "").toLowerCase()
	})
}

const isBodySubject = (subject) => subject === "body" || subject === "html" || subject === ":root"
const isHeadingSubject = (subject) => /^h[1-6](?![\w-])/.test(subject)
const isMonoSubject = (subject) => /^(?:code|pre|kbd|samp)(?![\w-])/.test(subject)
const isLinkSubject = (subject) => /^a(?![\w-])/.test(subject)

function formatStack(families) {
	return families.map((family) => (/^-?[A-Za-z_][\w-]*$/.test(family) ? family : JSON.stringify(family))).join(", ")
}

/** { body?, heading?, mono? } from font-family / font declarations, var() resolved. */
export function fontStacks(css) {
	const fonts = {}
	const entries = fontFamilies(css)
	const pick = (test) => entries.find((entry) => subjects(entry.selector).some(test))
	const body = pick(isBodySubject)
	const heading = pick(isHeadingSubject)
	const mono = pick(isMonoSubject) ?? entries.find((entry) => entry.families.at(-1)?.toLowerCase() === "monospace")
	if (body) fonts.body = formatStack(body.families)
	if (heading) fonts.heading = formatStack(heading.families)
	if (mono) fonts.mono = formatStack(mono.families)
	return fonts
}

function tokenRoles(name) {
	const roles = []
	if (/accent|primary|brand/i.test(name)) roles.push("accent")
	if (/(?:^--|-)bg(?:-|$)|background|surface/i.test(name)) roles.push("background")
	if (/border|(?:^--|-)rule(?:-|$)/i.test(name)) roles.push("border")
	return roles
}

function declarationRoles(selector, prop) {
	if (prop.startsWith("--")) return tokenRoles(prop)
	if (prop.startsWith("background")) return ["background"]
	if (prop.startsWith("border") || prop.startsWith("outline")) return ["border"]
	if (prop !== "color") return []
	const parts = subjects(selector)
	const roles = []
	if (parts.some(isLinkSubject)) roles.push("link")
	if (parts.some(isHeadingSubject)) roles.push("heading")
	if (parts.some(isBodySubject)) roles.push("body")
	return roles
}

/**
 * Top hex colors by use count (ties keep first appearance): each token definition counts once,
 * and each other declaration counts once per hex it resolves to (var() against light tokens).
 * Roles are guessed from the selector and property where the color is used.
 */
export function rankColors(css, lightTokens) {
	const table = new Map()
	for (const rule of scanRules(css)) {
		for (const { prop, value } of rule.declarations) {
			const roles = declarationRoles(rule.selector, prop)
			for (const hex of hexColors(prop.startsWith("--") ? value : resolveVar(value, lightTokens))) {
				const entry = table.get(hex) ?? { hex, count: 0, roles: new Set() }
				entry.count++
				for (const role of roles) entry.roles.add(role)
				table.set(hex, entry)
			}
		}
	}
	return [...table.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, TOP_COLORS)
		.map((entry) => ({ hex: entry.hex, count: entry.count, roles: ROLE_ORDER.filter((role) => entry.roles.has(role)) }))
}

/** { fontSize?, lineHeight?, maxWidth? }: body size and leading, plus the most used absolute max width. */
export function readingMeasure(css, lightTokens) {
	const measure = {}
	const rules = scanRules(css).filter((rule) => !rule.atRule)
	for (const rule of rules) {
		if (!subjects(rule.selector).some(isBodySubject)) continue
		for (const { prop, value } of rule.declarations) {
			if (prop === "font-size" && !measure.fontSize) measure.fontSize = resolveVar(value, lightTokens)
			if (prop === "line-height" && !measure.lineHeight) measure.lineHeight = resolveVar(value, lightTokens)
		}
	}
	const widths = new Map()
	for (const rule of rules) {
		for (const { prop, value } of rule.declarations) {
			if (prop !== "max-width" && prop !== "max-inline-size") continue
			const resolved = resolveVar(value, lightTokens).trim()
			if (ABSOLUTE_LENGTH.test(resolved)) widths.set(resolved, (widths.get(resolved) ?? 0) + 1)
		}
	}
	const widest = [...widths].sort((a, b) => b[1] - a[1])[0]
	if (widest) measure.maxWidth = widest[0]
	return measure
}

/** Every CSS-derived Extract field from one concatenated stylesheet. */
export function cssFacts(css) {
	const tokens = customProperties(css)
	return {
		tokens,
		fonts: fontStacks(css),
		colors: rankColors(css, tokens.light),
		breakpoints: mediaBreakpoints(css),
		measure: readingMeasure(css, tokens.light),
	}
}
