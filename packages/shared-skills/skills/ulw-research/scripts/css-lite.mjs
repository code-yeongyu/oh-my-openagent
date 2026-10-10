// css-lite.mjs - a tolerant, dependency-free CSS scanner for report gates and spec extraction.
//
// Never throws on malformed input: an unbalanced stylesheet yields the rules closed so far.
// Plain Node ESM, no imports.

const GROUP_AT = /^@(?:-[a-z]+-)?(?:media|supports|container|layer|document|scope|starting-style|keyframes)\b/i
const HEX = /(?<![\w&])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\w-])/gi
const DARK_MEDIA = /prefers-color-scheme\s*:\s*dark/i
const DARK_THEME = /\[data-theme\s*=\s*["']?dark/i
const TOKEN_SCOPE = /(?:^|[\s,>])(?::root|html)\b|^\[data-theme/i

function stripComments(css) {
	return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
}

/** Split on `separator` outside quotes and parentheses. */
function splitTopLevel(text, separator) {
	const parts = []
	let depth = 0
	let quote = null
	let current = ""
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (quote) {
			if (ch === "\\") current += ch + (text[++i] ?? "")
			else {
				if (ch === quote) quote = null
				current += ch
			}
			continue
		}
		if (ch === '"' || ch === "'") quote = ch
		else if (ch === "(") depth++
		else if (ch === ")") depth = Math.max(0, depth - 1)
		else if (ch === separator && depth === 0) {
			parts.push(current)
			current = ""
			continue
		}
		current += ch
	}
	parts.push(current)
	return parts
}

function parseDeclarations(text) {
	const declarations = []
	for (const piece of splitTopLevel(text, ";")) {
		const colon = piece.indexOf(":")
		if (colon <= 0) continue
		const rawProp = piece.slice(0, colon).trim()
		const value = piece.slice(colon + 1).trim()
		if (!rawProp || /[\s{}]/.test(rawProp)) continue
		declarations.push({ prop: rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase(), value })
	}
	return declarations
}

/**
 * @returns {{ selector: string, declarations: { prop: string, value: string }[], atRule?: string }[]}
 * atRule is the chain of enclosing grouping at-rule preludes joined by a space.
 */
export function scanRules(css) {
	if (typeof css !== "string") return []
	const src = stripComments(css)
	const slots = []
	const stack = []
	let buffer = ""
	for (let i = 0; i < src.length; i++) {
		const ch = src[i]
		if (ch === '"' || ch === "'") {
			let end = i + 1
			while (end < src.length && src[end] !== ch) end += src[end] === "\\" ? 2 : 1
			buffer += src.slice(i, end + 1)
			i = end
		} else if (ch === "{") {
			const pieces = splitTopLevel(buffer, ";")
			const prelude = pieces.pop().trim()
			const frame = stack.at(-1)
			if (frame && pieces.length) frame.body += `${pieces.join(";")};`
			const group = GROUP_AT.test(prelude)
			const slot = group ? -1 : slots.push(null) - 1
			stack.push({ prelude, group, slot, body: "" })
			buffer = ""
		} else if (ch === "}") {
			const frame = stack.pop()
			if (frame && !frame.group) {
				const atChain = stack.filter((entry) => entry.group).map((entry) => entry.prelude)
				const rule = { selector: frame.prelude, declarations: parseDeclarations(frame.body + buffer) }
				if (atChain.length) rule.atRule = atChain.join(" ")
				slots[frame.slot] = rule
			}
			buffer = ""
		} else if (ch === ";" && stack.length === 0) {
			buffer = ""
		} else {
			buffer += ch
		}
	}
	return slots.filter(Boolean)
}

function isDarkRule(rule) {
	if (rule.atRule && DARK_MEDIA.test(rule.atRule)) return true
	return DARK_THEME.test(rule.selector.replace(/:not\([^)]*\)/gi, ""))
}

/**
 * Global design tokens from `:root`, `html`, and `[data-theme]` rules. Dark = inside
 * `@media (prefers-color-scheme: dark)` or on a `[data-theme="dark"]` selector. Last value wins.
 * @returns {{ light: Map<string, string>, dark: Map<string, string> }}
 */
export function customProperties(css) {
	const light = new Map()
	const dark = new Map()
	for (const rule of scanRules(css)) {
		if (!rule.selector.split(",").some((part) => TOKEN_SCOPE.test(part.trim()))) continue
		const target = isDarkRule(rule) ? dark : light
		for (const { prop, value } of rule.declarations) if (prop.startsWith("--")) target.set(prop, value)
	}
	return { light, dark }
}

function splitFamilies(value) {
	return splitTopLevel(value, ",")
		.map((family) => family.trim().replace(/^(["'])(.*)\1$/, "$2").trim())
		.filter(Boolean)
}

/** Font stack after the size token of a `font` shorthand, or null when the shorthand has none. */
function shorthandFamilies(value) {
	const match = /(?:^|\s)[\d.]+(?:px|em|rem|pt|%|vw|vh|ch|ex)(?:\s*\/\s*\S+)?\s+(.+)$/i.exec(value)
	return match ? match[1] : null
}

/** @returns {{ selector: string, families: string[] }[]} var() references resolve against light tokens. */
export function fontFamilies(css) {
	const props = customProperties(css).light
	const result = []
	for (const rule of scanRules(css)) {
		for (const { prop, value } of rule.declarations) {
			const resolved = resolveVar(value, props)
			const stack = prop === "font-family" ? resolved : prop === "font" ? shorthandFamilies(resolved) : null
			if (stack === null) continue
			const families = splitFamilies(stack)
			if (families.length) result.push({ selector: rule.selector, families })
		}
	}
	return result
}

/** #abc / #abcd / #aabbcc / #aabbccdd -> #aabbcc (lowercase, alpha dropped); anything else -> null. */
export function normalizeHex(hex) {
	const match = /^#([0-9a-f]{3,8})$/i.exec(String(hex).trim())
	if (!match || ![3, 4, 6, 8].includes(match[1].length)) return null
	const digits = match[1].toLowerCase()
	const six = digits.length <= 4 ? [...digits.slice(0, 3)].map((d) => d + d).join("") : digits.slice(0, 6)
	return `#${six}`
}

/** Every hex color in `text`, normalized, in order of appearance, repeats kept. */
export function hexColors(text) {
	if (typeof text !== "string") return []
	return [...text.matchAll(HEX)].map((match) => normalizeHex(match[0]))
}

/** Unique px widths named in @media preludes (min-/max-width and range syntax), ascending. */
export function mediaBreakpoints(css) {
	if (typeof css !== "string") return []
	const widths = new Set()
	for (const media of stripComments(css).matchAll(/@media\b([^{;]*)/gi)) {
		for (const match of media[1].matchAll(/\b(?:min-|max-)?width\s*(?::|[<>]=?|=)\s*(\d+(?:\.\d+)?)px/gi)) {
			widths.add(Number(match[1]))
		}
	}
	return [...widths].sort((a, b) => a - b)
}

function lookup(props, name) {
	if (props instanceof Map) return props.get(name)
	return props && Object.hasOwn(props, name) ? props[name] : undefined
}

/** Substitute var(--name[, fallback]) from `props` (Map or object); unresolvable references keep their text. */
export function resolveVar(value, props, depth = 0) {
	if (typeof value !== "string" || depth > 10) return value
	let out = ""
	let cursor = 0
	for (;;) {
		const start = value.indexOf("var(", cursor)
		if (start === -1) return out + value.slice(cursor)
		let end = start + 4
		for (let open = 1; end < value.length && open > 0; end++) {
			if (value[end] === "(") open++
			else if (value[end] === ")") open--
		}
		const [name, ...rest] = splitTopLevel(value.slice(start + 4, end - 1), ",")
		const fallback = rest.length ? rest.join(",").trim() : undefined
		const replacement = lookup(props, name.trim()) ?? fallback
		const original = value.slice(start, end)
		out += value.slice(cursor, start) + (replacement === undefined ? original : resolveVar(replacement, props, depth + 1))
		cursor = end
	}
}
