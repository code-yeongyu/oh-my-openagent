// gates-figures.mjs - visual gates: G2 palette, G8 chart without figure, G9 chart svg text,
// G10 Korean serif/brush fonts.
//
// Each gate is { codes, skip?(ctx), run(ctx) -> Defect[] } over the context built by
// gates-static.mjs. Plain Node ESM, sibling imports only.

import { fontFamilies, hexColors, normalizeHex, resolveVar } from "./css-lite.mjs"
import { decodeEntities, proseText } from "./html-lite.mjs"

const ALWAYS_ALLOWED = new Set(["#ffffff", "#000000"])
const MAX_PALETTE = 20
const SVG_PAINT = /(?:fill|stroke|stop-color|flood-color|lighting-color)\s*(?:=\s*["']?|:\s*)(#[0-9a-f]{3,8})(?![\w-])/gi
const SVG_FONT = /font-family\s*(?:=\s*("[^"]*"|'[^']*')|:\s*([^;"'>]+))/gi
const ICON_MAX = 32
const CHART_MIN = 200
const ICON_NAME = /icon|logo/i
const ICON_HOSTS = new Set(["a", "button", "nav", "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6"])
const CAPTION_CLASS = /^(?:caption|fig-?cap(?:tion)?)$/
const DEFAULT_FONT_SIZE = 16
const MIN_TITLE_CHARS = 4
const MIN_TICKS = 3
const NUMERIC = /^[-+\u2212]?[$\u20AC\u00A3\u00A5\u20A9]?\d[\d,.:]*\s?(?:%|[a-z\uAC00-\uD7A3]{0,3})$/i
const SERIF_FAMILY = /nanummyeongjo|applemyungjo|gungsuh|batang|nanumbrush|nanumpen|\uAD81\uC11C|\uBC14\uD0D5|\uBA85\uC870/

function pixels(value) {
	const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value ?? "")
	return match ? Number(match[1]) : null
}

/** Largest declared dimension: width/height attributes or style, else the viewBox. */
function declaredSize(node) {
	const style = node.attrs.style ?? ""
	const fromStyle = (prop) => pixels(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(style)?.[1])
	const sizes = [pixels(node.attrs.width), pixels(node.attrs.height), fromStyle("width"), fromStyle("height")].filter((n) => n !== null)
	if (sizes.length) return Math.max(...sizes)
	const box = String(node.attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number)
	return box.length === 4 && box.every(Number.isFinite) ? Math.max(box[2], box[3]) : null
}

function isIcon(ctx, node) {
	const size = declaredSize(node)
	if (size !== null && size <= ICON_MAX) return true
	if (ICON_NAME.test(`${node.attrs.class ?? ""} ${node.attrs.id ?? ""}`)) return true
	return Boolean(ctx.util.closest(node, (cur) => ICON_HOSTS.has(cur.tag)))
}

const isFigure = (ctx) => (cur) => cur.tag === "figure" || ctx.util.classTokens(cur).includes("fig")

function hasCaption(ctx, figure) {
	return ctx.util.descendants(figure).some((node) => (node.tag === "figcaption" || ctx.util.classTokens(node).some((token) => CAPTION_CLASS.test(token))) && proseText(node).length > 0)
}

function visuals(ctx) {
	return ctx.elements.map(({ node }) => node).filter((node) => (node.tag === "img" || node.tag === "svg") && !isIcon(ctx, node))
}

function label(node) {
	if (node.tag === "img") {
		const src = node.attrs.src ?? ""
		return `<img src="${src.length > 48 ? `${src.slice(0, 48)}...` : src}">`
	}
	return `<svg${node.attrs.width ? ` width="${node.attrs.width}"` : ""}${node.attrs.height ? ` height="${node.attrs.height}"` : ""}>`
}

function svgTexts(raw) {
	return [...raw.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text\s*>/gi)]
		.map((match) => ({
			size: Number(/font-size\s*(?:=\s*["']?|:\s*)(\d+(?:\.\d+)?)/i.exec(match[1])?.[1] ?? DEFAULT_FONT_SIZE),
			value: decodeEntities(match[2].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim(),
		}))
		.filter((text) => text.value)
}

function missingChartLabels(raw) {
	const texts = svgTexts(raw)
	const title = decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(raw)?.[1] ?? "").trim()
	if (!texts.length && !title) return null
	const maxSize = Math.max(0, ...texts.map((text) => text.size))
	const missing = []
	if (!title && !texts.some((text) => text.size === maxSize && [...text.value].length >= MIN_TITLE_CHARS)) missing.push("title")
	const ticks = texts.filter((text) => NUMERIC.test(text.value)).length
	if (ticks < MIN_TICKS) missing.push(`numeric ticks (${ticks} < ${MIN_TICKS})`)
	if (!texts.some((text) => /\p{L}/u.test(text.value) && !NUMERIC.test(text.value))) missing.push("text label")
	return missing
}

function colorUses(ctx) {
	const uses = new Map()
	const add = (hex, node) => {
		const color = normalizeHex(hex)
		if (!color) return
		const entry = uses.get(color) ?? { node, count: 0 }
		entry.count++
		uses.set(color, entry)
	}
	for (const { node, css } of [...ctx.styleBlocks, ...ctx.styleAttrs]) for (const hex of hexColors(css)) add(hex, node)
	for (const node of ctx.all) {
		if (node.tag !== "svg") continue
		for (const key of ["fill", "stroke", "stop-color"]) if (node.attrs[key]) add(node.attrs[key], node)
		for (const match of (node.raw ?? "").matchAll(SVG_PAINT)) add(match[1], node)
	}
	return uses
}

function fontDeclarations(ctx) {
	const found = []
	for (const { node, css } of ctx.styleBlocks) for (const { families } of fontFamilies(css)) found.push({ node, families })
	for (const { node, css } of ctx.styleAttrs) for (const { families } of fontFamilies(`x{${resolveVar(css, ctx.tokens)}}`)) found.push({ node, families })
	for (const node of ctx.all) {
		if (node.tag !== "svg") continue
		const values = [node.attrs["font-family"], ...[...(node.raw ?? "").matchAll(SVG_FONT)].map((m) => m[1] ?? m[2])].filter(Boolean)
		for (const value of values) for (const { families } of fontFamilies(`x{font-family:${value}}`)) found.push({ node, families })
	}
	return found
}

export const figureGates = [
	{
		codes: ["palette_off_token"],
		skip: (ctx) => ctx.palette.size === 0,
		run(ctx) {
			const palette = new Set([...ctx.palette].map(normalizeHex))
			const defects = []
			for (const [color, { node, count }] of colorUses(ctx)) {
				if (defects.length >= MAX_PALETTE) break
				if (palette.has(color) || ALWAYS_ALLOWED.has(color)) continue
				defects.push(ctx.defect("palette_off_token", node, `color ${color} is not in the design-spec palette (${count} use${count === 1 ? "" : "s"})`))
			}
			return defects
		},
	},
	{
		codes: ["chart_without_figure"],
		run(ctx) {
			return visuals(ctx)
				.filter((node) => {
					const figure = ctx.util.closest(node, isFigure(ctx))
					return !figure || !hasCaption(ctx, figure)
				})
				.map((node) => ctx.defect("chart_without_figure", node, `${label(node)} has no figure container with a non-empty caption`))
		},
	},
	{
		codes: ["chart_svg_no_text", "chart_svg_missing_labels"],
		run(ctx) {
			const defects = []
			for (const node of visuals(ctx)) {
				if (node.tag !== "svg") continue
				if (!((declaredSize(node) ?? 0) >= CHART_MIN || ctx.util.closest(node, isFigure(ctx)))) continue
				const missing = missingChartLabels(node.raw ?? "")
				if (missing === null) defects.push(ctx.defect("chart_svg_no_text", node, `${label(node)} chart has no <text> and no <title>`))
				else if (missing.length) defects.push(ctx.defect("chart_svg_missing_labels", node, `${label(node)} chart is missing: ${missing.join(", ")}`))
			}
			return defects
		},
	},
	{
		codes: ["korean_serif_font"],
		run(ctx) {
			const defects = []
			const seen = new Set()
			for (const { node, families } of fontDeclarations(ctx)) {
				for (const family of families) {
					const key = family.toLowerCase().replace(/[\s"'_-]/g, "")
					if (!SERIF_FAMILY.test(key) || seen.has(key)) continue
					seen.add(key)
					defects.push(ctx.defect("korean_serif_font", node, `serif or brush Korean font family "${family}"`))
				}
			}
			return defects
		},
	},
]
