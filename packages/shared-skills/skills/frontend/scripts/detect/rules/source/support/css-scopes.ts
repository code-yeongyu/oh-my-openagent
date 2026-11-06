export type CssScope = {
	readonly selector: string
	readonly start: number
	readonly end: number
	readonly body: string
	readonly parent: CssScope | null
}

export function cssScopes(text: string, sass = false): readonly CssScope[] {
	if (sass) return sassScopes(text)
	const scopes: CssScope[] = []
	const stack: { selector: string; start: number; content: number; boundary: number; parent: number | null }[] = []
	let quote = ""
	let boundary = 0
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (quote) {
			if (ch === "\\") i++
			else if (ch === quote) quote = ""
			continue
		}
		if (ch === '"' || ch === "'") { quote = ch; continue }
		if (ch === "{") {
			if (/[$#@]/.test(text[i - 1] ?? "")) {
				let depth = 1
				while (++i < text.length && depth > 0) {
					if (text[i] === "{") depth++
					if (text[i] === "}") depth--
				}
				if (/^\s*(?:&|@|[.#])/.test(text.slice(i))) {
					const parent = stack.at(-1)
					if (parent) parent.boundary = i
					else boundary = i
				}
				i--
				continue
			}
			const from = stack.at(-1)?.boundary ?? boundary
			const raw = text.slice(from, i)
			const selector = raw.trim()
			const at = from + raw.length - raw.trimStart().length
			stack.push({ selector, start: at, content: i + 1, boundary: i + 1, parent: stack.at(-1)?.content ?? null })
		} else if (ch === "}") {
			const open = stack.pop()
			if (open) scopes.push({ selector: open.selector, start: open.start, end: i, body: text.slice(open.content, i), parent: null })
			const parent = stack.at(-1)
			if (parent) parent.boundary = i + 1
			else boundary = i + 1
		} else if (ch === ";" || ch === "`") {
			const parent = stack.at(-1)
			if (parent) parent.boundary = i + 1
			else boundary = i + 1
		}
	}
	const rootBody = text.replace(/\{[\s\S]*\}/g, "")
	if (/^\s*(?:[-\w]+\s*:|\$\{)/.test(text) || /^\s*(?:position|border|padding|color|background)[-\w]*\s*:/.test(rootBody)) scopes.push({ selector: "&", start: 0, end: text.length, body: text, parent: null })
	const ordered: CssScope[] = []
	for (const scope of scopes.sort((a, b) => a.start - b.start || b.end - a.end)) {
		ordered.push({ ...scope, parent: ordered.filter((p) => p.start <= scope.start && p.end > scope.end).sort((a, b) => b.start - a.start)[0] ?? null })
	}
	return ordered
}

function sassScopes(text: string): readonly CssScope[] {
	const rows = [...text.matchAll(/^.*$/gm)].map((m) => ({ line: m[0], offset: m.index ?? 0 }))
	const scopes: CssScope[] = []
	for (const [i, row] of rows.entries()) {
		const selector = row.line.trim()
		if (!selector || /^(?:[-\w]+\s*:|\$|\/\/)/.test(selector)) continue
		const indent = row.line.length - row.line.trimStart().length
		let end = text.length
		for (const next of rows.slice(i + 1)) {
			if (next.line.trim() && next.line.length - next.line.trimStart().length <= indent) { end = next.offset; break }
		}
		const bodyRows = rows.slice(i + 1).filter((r) => r.offset < end && r.line.trim())
		const level = Math.min(...bodyRows.map((r) => r.line.length - r.line.trimStart().length))
		const body = bodyRows.filter((r) => r.line.length - r.line.trimStart().length === level).map((r) => r.line).join("\n")
		scopes.push({ selector, start: row.offset + indent, end, body, parent: null })
	}
	const ordered: CssScope[] = []
	for (const s of scopes) ordered.push({ ...s, parent: ordered.filter((p) => p.start < s.start && p.end >= s.end).sort((a, b) => b.start - a.start)[0] ?? null })
	return ordered
}

export function declarations(body: string): ReadonlyMap<string, string> {
	const out = new Map<string, string>()
	let quote = ""
	let parens = 0
	let braces = 0
	let start = 0
	const push = (end: number): void => {
		const m = /^\s*["']?([-\w]+)["']?\s*:\s*([\s\S]*)$/.exec(body.slice(start, end))
		if (m?.[1] && m[2] !== undefined) out.set(m[1], m[2].trim().replace(/\s*!important\s*$/i, ""))
	}
	for (let i = 0; i < body.length; i++) {
		const ch = body[i]
		if (quote) {
			if (ch === "\\") i++
			else if (ch === quote) quote = ""
		} else if (ch === "'" || ch === '"' || ch === "`") quote = ch
		else if (ch === "(" || ch === "[") parens++
		else if (ch === ")" || ch === "]") parens--
		else if (ch === "{") braces++
		else if (ch === "}") {
			braces--
			if (braces === 0) start = i + 1
		} else if ((ch === ";" || ch === "\n" || ch === ",") && parens === 0 && braces === 0) { push(i); start = i + 1 }
	}
	if (start < body.length) push(body.length)
	return out
}

export function selectorHost(scope: CssScope): string {
	if (!scope.parent) return scope.selector
	const parent = selectorHost(scope.parent)
	if (scope.selector.startsWith("@") || scope.selector.startsWith("+")) return parent
	return scope.selector.includes("&") ? scope.selector.replace(/&/g, parent) : scope.selector
}

export const cleanSelector = (selector: string): string => selector.replace(/::?(?:before|after)\b/g, "").replace(/:(?:hover|focus|active|visited)(?:-[\w-]+)?/g, "").trim()

export function selectorMatches(base: string, target: string): boolean {
	return base.split(",").some((part) => {
		const a = cleanSelector(part.trim())
		const b = cleanSelector(target.trim())
		if (/::?(?:before|after)/.test(part) !== /::?(?:before|after)/.test(target)) return false
		if (a === b) return true
		const tokens = a.match(/\[[^\]]+\]|[.#][\w-]+|^[a-z][\w-]*/g)
		return tokens !== null && tokens.every((token) => b.includes(token)) && !/[ >+~]/.test(a)
	})
}
