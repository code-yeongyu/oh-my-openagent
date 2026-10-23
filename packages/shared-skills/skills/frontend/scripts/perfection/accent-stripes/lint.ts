import { type CssRule, type Declaration, parseCss } from "./css-parse"
import { hasAccentOutline, hasEdgeStripe, hasInsetShadowStripe, hasRadius, isPseudoBar, roundedCorners } from "./declarations"
import { type Finding, lineLocator, type RuleId } from "./findings"
import { hasGradientEdgeBand } from "./gradient"
import { classGroups, cssTemplates, inlineStyles, styleBlocks } from "./markup"
import { type Compound, compoundCovers, isExemptSelector, isExemptTag, parseCompound, selectorParts } from "./selector"
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

function isRoundedHost(part: string, rule: CssRule, index: readonly Compound[]): boolean {
	if (ruleHasRadius(rule)) return true
	const host = parseCompound(part)
	return index.some((general) => compoundCovers(general, host))
}

const EDGE_PROP = /^border(?:-(?:top|right|bottom|left|block|inline|width|color|image)(?:-[\w-]+)?)?$/
const OUTLINE_PROP = /^(?:border(?:-width|-color)?|box-shadow)$/
const BACKGROUND_PROP = /^background(?:-color|-image)?$/

function declarationOffset(declarations: readonly Declaration[], prop: RegExp, fallback: number): number {
	return declarations.find((d) => prop.test(d.prop) && !d.prop.endsWith("radius"))?.offset ?? fallback
}

type Hit = { readonly id: RuleId; readonly offset: number }

function declarationHits(declarations: readonly Declaration[], rounded: boolean, fallback: number): Hit[] {
	const hits: Hit[] = []
	if (hasEdgeStripe(declarations)) hits.push({ id: "edge-stripe", offset: declarationOffset(declarations, EDGE_PROP, fallback) })
	else if (rounded && hasAccentOutline(declarations)) hits.push({ id: "accent-outline", offset: declarationOffset(declarations, OUTLINE_PROP, fallback) })
	if (hasInsetShadowStripe(declarations)) hits.push({ id: "inset-shadow-stripe", offset: declarationOffset(declarations, /^box-shadow$/, fallback) })
	if (hasGradientEdgeBand(declarations)) hits.push({ id: "gradient-stripe", offset: declarationOffset(declarations, BACKGROUND_PROP, fallback) })
	return hits
}

function checkRule(rule: CssRule, index: readonly Compound[]): Hit[] {
	const found = new Map<RuleId, number>()
	const add = (hit: Hit) => found.set(hit.id, found.get(hit.id) ?? hit.offset)
	for (const part of selectorParts(rule.selector)) {
		if (isExemptSelector(part)) continue
		if (parseCompound(part).pseudoElement) {
			if (isPseudoBar(rule.declarations)) add({ id: "pseudo-bar", offset: declarationOffset(rule.declarations, BACKGROUND_PROP, rule.offset) })
			continue
		}
		const rounded = isRoundedHost(part, rule, index)
		declarationHits(rule.declarations, rounded, rule.offset).forEach(add)
		for (const id of checkClassSet(rule.applyClasses, rounded)) add({ id, offset: rule.applyOffset ?? rule.offset })
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
			if (isExemptTag(group.tag)) continue
			for (const id of checkClassSet(group.tokens)) report(group.offset, id)
		}
		for (const style of inlineStyles(file.text)) {
			if (isExemptTag(style.tag)) continue
			const rounded = style.tagRounded || roundedCorners(style.declarations).size > 0
			for (const hit of declarationHits(style.declarations, rounded, style.offset)) report(style.offset, hit.id)
		}
	}
	return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
}
