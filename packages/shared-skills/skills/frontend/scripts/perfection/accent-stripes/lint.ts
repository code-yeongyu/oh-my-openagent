import { type CssRule, type Declaration, parseCss } from "./css-parse"
import { ALL_CORNERS, type Corner, hasEdgeStripe, hasInsetShadowStripe, hasRadius, isPseudoBar, roundedCorners } from "./declarations"
import { type Finding, lineLocator, type RuleId } from "./findings"
import { hasGradientEdgeBand } from "./gradient"
import { classGroups, cssTemplates, inlineStyles, styleBlocks } from "./markup"
import { type Compound, compoundCovers, isExemptSelector, parseCompound, selectorParts } from "./selector"
import { checkClassSet } from "./tailwind"

export type SourceFile = { readonly path: string; readonly text: string }

const STYLESHEET = /\.(?:css|scss|less|pcss|postcss)$/i
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/i

function cssRulesOf(file: SourceFile): CssRule[] {
	if (STYLESHEET.test(file.path)) return parseCss(file.text, 0, !/\.css$/i.test(file.path))
	const blocks = SCRIPT.test(file.path) ? cssTemplates(file.text) : styleBlocks(file.text)
	return blocks.flatMap((b) => parseCss(b.css, b.offset, true))
}

function ruleHasRadius(rule: CssRule): boolean {
	return hasRadius(rule.declarations) || rule.applyClasses.some((c) => /^rounded(?:-|$)/.test(c) && !/none$/.test(c))
}

function radiusIndex(rules: readonly CssRule[]): Compound[] {
	return rules.filter(ruleHasRadius).flatMap((r) => selectorParts(r.selector).map(parseCompound))
}

const NO_CORNERS: ReadonlySet<Corner> = new Set()

function hostCorners(part: string, rule: CssRule, index: readonly Compound[]): ReadonlySet<Corner> {
	if (!parseCompound(part).pseudoElement) {
		if (hasRadius(rule.declarations)) return roundedCorners(rule.declarations)
		if (ruleHasRadius(rule)) return ALL_CORNERS
	}
	const host = parseCompound(part.replace(/::?(before|after)\b/gi, ""))
	return index.some((general) => compoundCovers(general, host)) ? ALL_CORNERS : NO_CORNERS
}

const EDGE_PROP = /^border(?:-(?:top|right|bottom|left|block|inline|width|color|image)(?:-[\w-]+)?)?$/
const BACKGROUND_PROP = /^background(?:-color|-image)?$/

function declarationOffset(declarations: readonly Declaration[], prop: RegExp, fallback: number): number {
	return declarations.find((d) => prop.test(d.prop) && !d.prop.endsWith("radius"))?.offset ?? fallback
}

type Hit = { readonly id: RuleId; readonly offset: number }

function declarationHits(declarations: readonly Declaration[], corners: ReadonlySet<Corner>, fallback: number): Hit[] {
	const hits: Hit[] = []
	if (hasEdgeStripe(declarations, corners)) hits.push({ id: "edge-stripe", offset: declarationOffset(declarations, EDGE_PROP, fallback) })
	if (hasInsetShadowStripe(declarations)) hits.push({ id: "inset-shadow-stripe", offset: declarationOffset(declarations, /^box-shadow$/, fallback) })
	if (hasGradientEdgeBand(declarations)) hits.push({ id: "gradient-stripe", offset: declarationOffset(declarations, BACKGROUND_PROP, fallback) })
	return hits
}

function checkRule(rule: CssRule, index: readonly Compound[]): Hit[] {
	const found = new Map<RuleId, number>()
	const add = (hit: Hit) => found.set(hit.id, found.get(hit.id) ?? hit.offset)
	for (const part of selectorParts(rule.selector)) {
		const corners = isExemptSelector(part) ? NO_CORNERS : hostCorners(part, rule, index)
		if (corners.size === 0) continue
		if (parseCompound(part).pseudoElement) {
			if (isPseudoBar(rule.declarations)) add({ id: "pseudo-bar", offset: declarationOffset(rule.declarations, BACKGROUND_PROP, rule.offset) })
			continue
		}
		declarationHits(rule.declarations, corners, rule.offset).forEach(add)
		const ownRounding = rule.applyClasses.some((c) => c.startsWith("rounded"))
		for (const id of checkClassSet(ownRounding ? rule.applyClasses : ["rounded", ...rule.applyClasses])) {
			add({ id, offset: rule.applyOffset ?? rule.offset })
		}
	}
	return [...found].map(([id, offset]) => ({ id, offset }))
}

function excerptAt(text: string, offset: number): string {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1
	const lineEnd = text.indexOf("\n", offset)
	return text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim().slice(0, 140)
}

export function lintFiles(files: readonly SourceFile[]): Finding[] {
	const rulesByFile = new Map(files.map((f) => [f.path, cssRulesOf(f)]))
	const index = radiusIndex([...rulesByFile.values()].flat())
	const findings: Finding[] = []
	for (const file of files) {
		const locate = lineLocator(file.text)
		const seen = new Set<string>()
		const report = (offset: number, rule: RuleId) => {
			const at = locate(offset)
			const key = `${at.line}:${rule}`
			if (seen.has(key)) return
			seen.add(key)
			findings.push({ file: file.path, ...at, rule, excerpt: excerptAt(file.text, offset) })
		}
		for (const rule of rulesByFile.get(file.path) ?? []) {
			for (const hit of checkRule(rule, index)) report(hit.offset, hit.id)
		}
		if (STYLESHEET.test(file.path)) continue
		for (const group of classGroups(file.text, SCRIPT.test(file.path))) {
			for (const id of checkClassSet(group.tokens)) report(group.offset, id)
		}
		for (const style of inlineStyles(file.text)) {
			const own = roundedCorners(style.declarations)
			const corners = own.size > 0 ? own : style.tagRounded ? ALL_CORNERS : NO_CORNERS
			if (corners.size === 0) continue
			for (const hit of declarationHits(style.declarations, corners, style.offset)) report(style.offset, hit.id)
		}
	}
	return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
}
