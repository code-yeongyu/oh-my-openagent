export type Element = {
	readonly tag: string
	readonly name: string
	readonly classes: readonly string[]
	readonly stateful: boolean
}

/** `text` is visible copy, `label` an announced attribute (aria-label, title, alt, placeholder), `value` a stat component's value prop. */
export type NodeKind = "text" | "label" | "value"
export type TextNode = { readonly kind: NodeKind; readonly text: string; readonly offset: number; readonly stack: readonly Element[] }

export type MarkupKind = "html" | "jsx" | "sfc"

const NEVER_RENDERED = /<(script|style|pre|code|textarea|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\/\}/gi
const HTML_TEMPLATE = /<template\b(?![^>]*\s(?:x-[\w-]+|v-[\w-]+|[:@#][\w.-]+))[^>]*>[\s\S]*?<\/template\s*>/gi
const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g
const CLASS_ATTR = /\b(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^{}]*\})*)\})/
const STRING_LITERAL = /["'`]([^"'`]*)["'`]/g
const ANNOUNCED_NAME = /(?:^|\s)(?:aria-label|title|alt|placeholder)\s*=/g
const VALUE_NAME = /(?:^|\s)value\s*=/
const LITERAL_VALUE = /^\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/
const HIDDEN_ATTR = /(?:^|\s)hidden(?=\s|=|\/|$)/
const STATE_ATTR = /(?:^|\s)(?:data-status|data-state|aria-(?:current|selected|pressed|checked|expanded|busy|invalid|disabled|valuenow))\s*=/
const ATTR_VALUES = /"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}/g
const STAT_COMPONENT = /^(?:Stats?|Metrics?|Kpis?|KPIs?)(?:[A-Z]\w*)?$/
const STAT_CLASS = /^(?:stat|stats|metric|metrics|kpi)(?:$|[-_])/
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])
const JSX_LEAD = new Set(["(", "[", "{", "}", ",", ":", "?", "=", ">", "&", "|", ";"])

function blank(text: string, pattern: RegExp): string {
	return text.replace(pattern, (m) => m.replace(/[^\n]/g, " "))
}

function classesOf(attrs: string): string[] {
	const m = CLASS_ATTR.exec(attrs)
	if (!m) return []
	const literal = m[1] ?? m[2]
	const raw = literal ?? [...(m[3] ?? "").matchAll(STRING_LITERAL)].map((s) => s[1] ?? "").join(" ")
	return raw.split(/\s+/).filter(Boolean)
}

export function isStatElement(element: Element): boolean {
	return STAT_COMPONENT.test(element.name) || element.classes.some((c) => STAT_CLASS.test(c))
}

function closeTo(stack: Element[], tag: string): void {
	const at = stack.map((e) => e.tag).lastIndexOf(tag)
	if (at >= 0) stack.length = at
}

/** In a script, `<` opens JSX only where an expression can start; `Array<string>`, `pick<T>(` and `a<b` stay code. */
function opensJsx(text: string, start: number, name: string, attrs: string): boolean {
	if (/^\s*,|^\s+extends\b/.test(attrs)) return false
	if (/^(?:const|in|out)$/.test(name) && /^\s+[A-Za-z_$]/.test(attrs)) return false
	const before = text.slice(0, start).trimEnd()
	if (before === "" || /\b(?:return|yield|default)$/.test(before)) return true
	return JSX_LEAD.has(before.at(-1) ?? "")
}

function literalAfter(attrs: string, from: number): { readonly value: string; readonly at: number } | null {
	const m = LITERAL_VALUE.exec(attrs.slice(from))
	if (!m) return null
	const value = m[1] ?? m[2] ?? m[3] ?? ""
	return { value, at: from + m[0].lastIndexOf(value) }
}

function keepLiterals(segment: string): string {
	return segment.replace(/\{[^{}]*\}/g, (m) => {
		const lit = /^\{\s*(["'`])([^"'`]*)\1\s*\}$/.exec(m)
		if (!lit) return " ".repeat(m.length)
		const inner = lit[2] ?? ""
		const at = m.indexOf(lit[1] ?? "") + 1
		return " ".repeat(at) + inner + " ".repeat(m.length - at - inner.length)
	})
}

/** Copy a reader sees or hears, each piece with the elements open around it. Code, hidden elements and never-rendered blocks are skipped. */
export function textNodes(source: string, kind: MarkupKind): TextNode[] {
	const text = kind === "html" ? blank(blank(source, NEVER_RENDERED), HTML_TEMPLATE) : blank(source, NEVER_RENDERED)
	const nodes: TextNode[] = []
	const stack: Element[] = []
	let hiddenDepth = 0
	let cursor = 0
	const flush = (end: number) => {
		if (stack.length === 0 || hiddenDepth > 0) return
		const segment = keepLiterals(text.slice(cursor, end))
		if (segment.trim()) nodes.push({ kind: "text", text: segment, offset: cursor, stack: [...stack] })
	}
	for (const m of text.matchAll(TAG)) {
		const start = m.index ?? 0
		const [whole, closing, rawName = "", attrs = ""] = m
		const end = start + whole.length
		if (kind === "jsx" && !closing && stack.length === 0 && !opensJsx(text, start, rawName, attrs)) continue
		flush(start)
		cursor = end
		const tag = rawName.toLowerCase()
		if (closing) {
			const at = stack.map((e) => e.tag).lastIndexOf(tag)
			if (at >= 0 && hiddenDepth > at) hiddenDepth = 0
			closeTo(stack, tag)
			continue
		}
		const names = attrs.replace(ATTR_VALUES, (v) => " ".repeat(v.length))
		const element: Element = { tag, name: rawName, classes: classesOf(attrs), stateful: STATE_ATTR.test(names) }
		const attrsAt = start + 1 + rawName.length
		const hidden = hiddenDepth > 0 || HIDDEN_ATTR.test(names)
		if (!hidden) {
			for (const a of names.matchAll(ANNOUNCED_NAME)) {
				const lit = literalAfter(attrs, (a.index ?? 0) + a[0].length)
				if (lit?.value.trim()) nodes.push({ kind: "label", text: lit.value, offset: attrsAt + lit.at, stack: [...stack, element] })
			}
			const v = isStatElement(element) ? VALUE_NAME.exec(names) : null
			const lit = v ? literalAfter(attrs, v.index + v[0].length) : null
			if (lit?.value.trim()) nodes.push({ kind: "value", text: lit.value, offset: attrsAt + lit.at, stack: [...stack, element] })
		}
		if (VOID_TAGS.has(tag) || attrs.trimEnd().endsWith("/")) continue
		stack.push(element)
		if (hiddenDepth === 0 && HIDDEN_ATTR.test(names)) hiddenDepth = stack.length
	}
	return nodes
}
