export type Declaration = { readonly prop: string; readonly value: string; readonly offset?: number }

export type CssRule = {
	readonly selector: string
	readonly declarations: readonly Declaration[]
	readonly applyClasses: readonly string[]
	readonly applyOffset?: number
	readonly offset: number
}

type Frame = { selector: string; declarations: Declaration[]; applyClasses: string[]; applyOffset?: number; offset: number }

function blankComments(text: string, lineComments: boolean): string {
	let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
	if (lineComments) out = out.replace(/(^|[^:"'])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length))
	return out
}

export function splitTopLevel(value: string, separator: "," | " "): string[] {
	const parts: string[] = []
	let depth = 0
	let current = ""
	for (const ch of value) {
		if (ch === "(" || ch === "[") depth += 1
		if (ch === ")" || ch === "]") depth -= 1
		const splits = depth === 0 && (separator === "," ? ch === "," : /\s/.test(ch))
		if (splits) {
			if (current.trim()) parts.push(current.trim())
			current = ""
		} else current += ch
	}
	if (current.trim()) parts.push(current.trim())
	return parts
}

function resolveSelector(parent: string | undefined, child: string): string {
	if (!parent) return child
	const parents = splitTopLevel(parent, ",")
	return splitTopLevel(child, ",")
		.flatMap((c) => parents.map((p) => (c.includes("&") ? c.replaceAll("&", p) : `${p} ${c}`)))
		.join(", ")
}

function nearestSelector(stack: readonly Frame[]): string | undefined {
	for (let i = stack.length - 1; i >= 0; i -= 1) {
		const frame = stack[i]
		if (frame && !frame.selector.startsWith("@")) return frame.selector
	}
	return undefined
}

function addStatement(frame: Frame | undefined, statement: string, offset: number): void {
	const text = statement.trim()
	if (!frame || !text) return
	if (text.startsWith("@apply")) {
		frame.applyOffset ??= offset
		frame.applyClasses.push(...text.slice("@apply".length).replace(/!important/g, "").split(/\s+/).filter(Boolean))
		return
	}
	const colon = text.indexOf(":")
	if (colon <= 0) return
	frame.declarations.push({ prop: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim(), offset })
}

export function parseCss(source: string, baseOffset = 0, lineComments = false): CssRule[] {
	const text = blankComments(source, lineComments)
	const rules: CssRule[] = []
	const stack: Frame[] = []
	let buffer = ""
	let bufferStart = -1
	let parens = 0
	let quote = ""
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charAt(i)
		if (quote) {
			buffer += ch
			if (ch === quote && text.charAt(i - 1) !== "\\") quote = ""
			continue
		}
		if (ch === '"' || ch === "'") quote = ch
		if (ch === "(") parens += 1
		if (ch === ")") parens -= 1
		if (parens > 0 || quote || (ch !== "{" && ch !== "}" && ch !== ";")) {
			if (bufferStart < 0 && /\S/.test(ch)) bufferStart = i
			buffer += ch
			continue
		}
		const top = stack[stack.length - 1]
		if (ch === "{") {
			const raw = buffer.trim()
			const selector = raw.startsWith("@") ? raw : resolveSelector(nearestSelector(stack), raw)
			stack.push({ selector, declarations: [], applyClasses: [], offset: baseOffset + Math.max(bufferStart, 0) })
		} else if (ch === ";") addStatement(top, buffer, baseOffset + Math.max(bufferStart, 0))
		else {
			addStatement(top, buffer, baseOffset + Math.max(bufferStart, 0))
			const done = stack.pop()
			if (done && !done.selector.startsWith("@")) rules.push(done)
		}
		buffer = ""
		bufferStart = -1
	}
	return rules
}
