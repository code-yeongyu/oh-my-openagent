// design-spec.mjs - read the palette and lineage mode out of design-spec.md, and render a
// design-spec.md draft from a format extract. Nothing is guessed: every value the extract
// does not carry is written `TODO: ask` and listed under Open questions.
// Plain Node ESM, node: builtins and siblings only.

import { DESIGN_SPEC_SECTIONS, LINEAGE_MODES } from "./contracts.mjs"
import { hexColors } from "./css-lite.mjs"

const TODO = "TODO: ask"
// English and Korean section names (the requester writes specs in either language).
const PALETTE_HEADING = /^(palette|tokens|colou?rs?|\uD1A0\uD070|\uD314\uB808\uD2B8|\uC0C9\uC0C1|\uCEEC\uB7EC)/i
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const TOKEN_DECLARATION = /--[\w-]+\s*:\s*([^;]*)/g
const FIGURE_STANDARD =
	"Each figure sits in a fixed-size container with a caption; the image scales to fit with its aspect ratio preserved (object-fit: contain), never stretched, cropped, or spilling out. Every chart carries a title, axis labels, units, and value labels."

/**
 * Walk markdown lines with fence awareness.
 * visit(line, { fenced, heading: { level, text } | null })
 */
function walkLines(markdown, visit) {
	let fence = null
	for (const line of String(markdown ?? "").split(/\r?\n/)) {
		const fenceMatch = FENCE.exec(line)
		if (fence) {
			const closes = fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]
			if (closes) fence = null
			else visit(line, { fenced: true, heading: null })
			continue
		}
		if (fenceMatch) {
			fence = fenceMatch[1]
			continue
		}
		const heading = HEADING.exec(line)
		visit(line, { fenced: false, heading: heading ? { level: heading[1].length, text: heading[2].replace(/^[\d.\s]+/, "") } : null })
	}
}

/**
 * Palette = hex values of every `--x: #hex` inside any fenced code block, plus every hex
 * anywhere under a heading named Palette / Tokens / Colors / Colours or their Korean equivalents (subheadings included).
 * @returns {Set<string>} normalized #rrggbb values
 */
export function parsePalette(specMarkdown) {
	const palette = new Set()
	let paletteLevel = 0
	walkLines(specMarkdown, (line, { fenced, heading }) => {
		if (heading) {
			if (paletteLevel && heading.level > paletteLevel) return
			paletteLevel = PALETTE_HEADING.test(heading.text) ? heading.level : 0
			return
		}
		if (fenced) for (const match of line.matchAll(TOKEN_DECLARATION)) for (const hex of hexColors(match[1])) palette.add(hex)
		if (paletteLevel) for (const hex of hexColors(line)) palette.add(hex)
	})
	return palette
}

/** `Lineage: inline|section` under the Citations heading; absent or unrecognized -> "inline". */
export function parseLineageMode(specMarkdown) {
	let citationsLevel = 0
	let mode = null
	walkLines(specMarkdown, (line, { fenced, heading }) => {
		if (mode || fenced) return
		if (heading) {
			if (citationsLevel && heading.level > citationsLevel) return
			citationsLevel = /^citations\b/i.test(heading.text) ? heading.level : 0
			return
		}
		const match = citationsLevel ? /^\s*(?:[-*]\s+)?lineage\s*:\s*(\S+)/i.exec(line) : null
		if (match && LINEAGE_MODES.includes(match[1].toLowerCase())) mode = match[1].toLowerCase()
	})
	return mode ?? "inline"
}

function entriesOf(value) {
	if (value instanceof Map) return [...value]
	return value !== null && typeof value === "object" ? Object.entries(value) : []
}

function isKnown(value) {
	if (value === undefined || value === null || value === "" || value === "unknown") return false
	if (Array.isArray(value)) return value.length > 0
	return true
}

function tokenFence(entries, dark) {
	const lines = entries.map(([name, value]) => `${dark ? "    " : "  "}${name}: ${value};`)
	const body = dark ? ["@media (prefers-color-scheme: dark) {", "  :root {", ...lines, "  }", "}"] : [":root {", ...lines, "}"]
	return ["```css", ...body, "```"]
}

/**
 * Render a design-spec.md draft. `extract` follows the format-extract shape
 * ({ origin, bytes, date?, tokens: { light, dark }, fonts, colors, breakpoints, headingNumbering,
 * citationStyle, lineageMode, figureContainers, skeleton, measure, notes }); every field is optional.
 * @returns {string}
 */
export function renderDesignSpec(extract = {}) {
	const source = extract ?? {}
	const open = []
	const field = (label, value, format = String) => {
		if (isKnown(value)) return format(value)
		open.push(label)
		return TODO
	}
	const fonts = source.fonts ?? {}
	const measure = source.measure ?? {}
	const light = entriesOf(source.tokens?.light)
	const dark = entriesOf(source.tokens?.dark)
	const colors = Array.isArray(source.colors) ? source.colors : []
	const skeleton = Array.isArray(source.skeleton) ? source.skeleton : []
	const notes = Array.isArray(source.notes) ? source.notes : []

	const sections = {
		"Extracted from": [
			`- Source: ${field("Source path or URL", source.origin)}`,
			`- Bytes: ${field("Source byte count", source.bytes)}`,
			`- Date: ${source.date ?? new Date().toISOString().slice(0, 10)}`,
			...notes.map((note) => `- Note: ${note}`),
		],
		Tokens: [
			...(light.length ? tokenFence(light, false) : [`- Light tokens: ${field("Light tokens", null)}`]),
			...(dark.length ? tokenFence(dark, true) : [`- Dark tokens: ${field("Dark tokens", null)}`]),
			...(colors.length
				? ["- Top colors:", ...colors.map((c) => `  - ${c.hex}${c.count ? ` (${c.count} uses${c.roles?.length ? `; ${c.roles.join(", ")}` : ""})` : ""}`)]
				: [`- Top colors: ${field("Top colors", null)}`]),
		],
		Typography: [
			`- Body font: ${field("Body font", fonts.body)}`,
			`- Heading font: ${field("Heading font", fonts.heading)}`,
			`- Mono font: ${field("Mono font", fonts.mono)}`,
			`- Body size: ${field("Body size", measure.fontSize)}`,
			`- Line height: ${field("Line height", measure.lineHeight)}`,
		],
		Layout: [
			`- Breakpoints: ${field("Breakpoints", source.breakpoints, (list) => list.map((px) => `${px}px`).join(", "))}`,
			`- Measure (max width): ${field("Measure", measure.maxWidth)}`,
		],
		Structure: [
			`- Heading numbering: ${field("Heading numbering", source.headingNumbering)}`,
			skeleton.length ? "- Skeleton:" : `- Skeleton: ${field("Section skeleton", null)}`,
			...skeleton.map((entry) => `${"  ".repeat(Math.max(1, entry.level))}- ${entry.text}`),
		],
		Figures: [
			`- Containers: ${field("Figure containers", source.figureContainers, (list) => list.join(", "))}`,
			`- Standard: ${FIGURE_STANDARD}`,
		],
		Citations: [
			`- Style: ${field("Citation style", source.citationStyle)}`,
			`- Lineage: ${field("Lineage mode", LINEAGE_MODES.includes(source.lineageMode) ? source.lineageMode : null)}`,
		],
	}
	sections["Open questions"] = open.length ? open.map((label) => `- ${label}: ${TODO}`) : ["- None"]

	const out = ["# Design spec", ""]
	for (const heading of DESIGN_SPEC_SECTIONS) out.push(`## ${heading}`, ...(sections[heading] ?? [`- ${TODO}`]), "")
	return out.join("\n")
}
