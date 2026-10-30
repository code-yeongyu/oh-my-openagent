import { ancestors, childrenOf, fontSizePx, isHeading, px, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

export const readingTags = ["p", "li", "td", "th", "dd", "blockquote", "figcaption"]
export const lineage = (s: PageSnapshot, e: ElementSnapshot): readonly ElementSnapshot[] => [e, ...ancestors(s, e)]
export const className = (e: ElementSnapshot): string => e.attributes["class"] ?? ""
export const mono = (e: ElementSnapshot): boolean => {
	const first = (styleOf(e, "font-family").split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "").toLowerCase()
	return ["courier", "courier new", "consolas", "menlo", "monaco", "andale mono", "lucida console"].includes(first) ||
		first.split(/[^a-z0-9]+/).some(w => ["mono", "monospace", "monospaced", "sfmono"].includes(w))
}
export const letters = (text: string): readonly string[] => [...text].filter(c => /\p{L}/u.test(c))
export const cjkChar = (c: string): boolean => /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u9fff\ua960-\ud7ff\uf900-\ufaff\uff66-\uff9f\u{20000}-\u{3ffff}]/u.test(c)
export const cjk = (text: string): boolean => {
	const sample = [...text].slice(0, 256)
	const count = sample.filter(cjkChar).length
	return count > 0 && count * 2 >= sample.filter(c => /\p{L}/u.test(c)).length
}
export const caps = (text: string): boolean => {
	const chars = letters(text)
	return chars.some(c => c.toUpperCase() !== c.toLowerCase()) && chars.every(c => /\p{Lu}/u.test(c))
}

export function visibleText(s: PageSnapshot, e: ElementSnapshot): boolean {
	const box = (e.rect.width > 0 && e.rect.height > 0) || e.lineRects.some(r => r.width > 0 && r.height > 0)
	return box && lineage(s, e).every(n =>
		n.attributes["hidden"] === undefined && styleOf(n, "display") !== "none" &&
		styleOf(n, "visibility") !== "collapse" && styleOf(n, "visibility") !== "hidden" &&
		styleOf(n, "content-visibility") !== "hidden" &&
		(Number.parseFloat(styleOf(n, "opacity")) <= 0.01) === false &&
		((n.rect.width <= 0 || n.rect.height <= 0) &&
			["overflow-x", "overflow-y"].some(p => ["hidden", "clip"].includes(styleOf(n, p)))) === false &&
		/sr-only|visually-?hidden|screen-?reader|a11y-hidden|hidden-visually/i.test(className(n)) === false &&
		/^(script|style|title|noscript|template|head|meta|link|base|param|source|track|datalist|col|colgroup|area)$/.test(n.tag) === false &&
		/inset\(\s*(50%|99|100%)/.test(styleOf(n, "clip-path")) === false)
}

export function control(s: PageSnapshot, e: ElementSnapshot): boolean {
	return lineage(s, e).some(n =>
		["button", "summary", "label", "select", "textarea"].includes(n.tag) ||
		(n.tag === "a" && n.attributes["href"] !== undefined) ||
		/^(button|link|tab|menuitem|menuitemcheckbox|menuitemradio|option|checkbox|radio|switch|treeitem)$/.test(n.attributes["role"] ?? "") ||
		(n.attributes["tabindex"] !== undefined && Number(n.attributes["tabindex"]) >= 0 && n.text.length <= 80))
}

export function headingText(s: PageSnapshot, e: ElementSnapshot): boolean {
	for (const n of lineage(s, e)) {
		if (isHeading(n) || n.attributes["role"] === "heading") return true
		if (readingTags.includes(n.tag)) return false
	}
	return false
}

export function pitch(s: PageSnapshot, e: ElementSnapshot): number {
	let height = px(styleOf(e, "line-height")) ?? 0
	if (styleOf(e, "display") === "inline") {
		for (const n of ancestors(s, e)) {
			height = Math.max(height, px(styleOf(n, "line-height")) ?? 0)
			if (["inline", "contents"].includes(styleOf(n, "display")) === false) break
		}
	}
	return height
}

export const smallprint = (s: PageSnapshot, e: ElementSnapshot): boolean => lineage(s, e).some(n =>
	["small", "footer"].includes(n.tag) || /legal|copyright|disclaimer|small-?print|fine-?print|disclosure|footnote/i.test(className(n)))

export function finePrintExempt(s: PageSnapshot, e: ElementSnapshot): boolean {
	if (fontSizePx(e) <= 0 || fontSizePx(e) >= 15 ||
		lineage(s, e).some(n => n.tag === "label" || isHeading(n)) ||
		childrenOf(s, e).some(n => ["input", "select", "textarea", "button"].includes(n.tag))) return false
	const marked: ElementSnapshot[] = []
	for (const n of lineage(s, e).slice(0, 4)) {
		if (["html", "body", "main", "article", "form"].includes(n.tag)) break
		const words = `${className(n)} ${n.attributes["id"] ?? ""}`.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()
		if (/(?:^|[-_\s])(legal|fine-?print|small-?print|disclaimers?|footnotes?|disclosures)(?:$|[-_\s])/.test(words) &&
			/(?:type|text|typography|font|fs)[-_]footnote/.test(words) === false) marked.push(n)
	}
	if (marked.length === 0 || marked.some(n => n.tag === "details" || n.tag === "summary" ||
		n.attributes["aria-expanded"] !== undefined || childrenOf(s, n).some(c => c.tag === "summary" || c.attributes["aria-expanded"] !== undefined))) return false
	const outer = marked[marked.length - 1]
	if (outer && outer.text.length >= 2000 &&
		outer.text.length >= (s.elements.find(n => n.tag === "body")?.text.length ?? 0) * 0.5 &&
		lineage(s, outer).some(n => n.tag === "footer" || n.attributes["role"] === "contentinfo") === false) return false
	return true
}

export const codeContext = (s: PageSnapshot, e: ElementSnapshot): boolean => lineage(s, e).some(n =>
	["pre", "code", "kbd", "samp", "var", "svg"].includes(n.tag) ||
	n.attributes["aria-hidden"] === "true" || /terminal|console|code|mock|editor|syntax|diff/i.test(className(n)))

export const uiContext = (s: PageSnapshot, e: ElementSnapshot): boolean => lineage(s, e).some(n =>
	["button", "a", "label", "summary", "pre", "nav", "footer"].includes(n.tag) ||
	n.attributes["aria-hidden"] === "true" ||
	/^(button|link|tab|menuitem|option)$/.test(n.attributes["role"] ?? "") ||
	/badge|caption|chip|code|console|diff|label|meta|mock|pill|preview|tag|terminal|writes/i.test(className(n)))

export function buttonBox(s: PageSnapshot, e: ElementSnapshot): boolean {
	for (const n of lineage(s, e).slice(0, 3)) {
		if (n !== e && n.text.length > 80) return false
		if (className(n).toLowerCase().split(/\s+/).some(t => t === "btn" || t.endsWith("-btn") || t.endsWith("_btn"))) return true
	}
	return false
}

export const furnitureClass = (value: string): boolean => value.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()
	.split(/[-_\s]+/).some(raw => {
		const part = raw.replace(/[^\p{L}\p{N}]/gu, "")
		return ["pillar", "pillars", "navy"].includes(part) === false &&
			["meta", "label", "badge", "chip", "pill", "tag", "kicker", "eyebrow", "breadcrumb", "timestamp", "category", "caption", "nav"]
				.some(w => part.startsWith(w) || part.endsWith(w))
	})
