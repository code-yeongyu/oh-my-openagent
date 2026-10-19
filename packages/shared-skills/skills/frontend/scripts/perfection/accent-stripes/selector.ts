import { splitTopLevel } from "./css-parse"

export type Compound = {
	readonly tag: string
	readonly classes: readonly string[]
	readonly ids: readonly string[]
	readonly pseudoElement: boolean
}

const EXEMPT_STATE = /:(focus-visible|invalid|user-invalid)\b|\[aria-invalid|\.(is-invalid|has-error|was-validated)\b/i
const EXEMPT_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "th", "td", "hr", "input", "select", "textarea"])

function lastCompound(part: string): string {
	const pieces = part.replace(/[>+~]/g, " ").split(/\s+(?![^[(]*[\])])/).filter(Boolean)
	return pieces[pieces.length - 1] ?? ""
}

export function parseCompound(part: string): Compound {
	const raw = lastCompound(part)
	const pseudoElement = /::?(before|after)\b/i.test(raw)
	const bare = raw.replace(/::?[\w-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "")
	return {
		tag: (/^[a-z][\w-]*/i.exec(bare)?.[0] ?? "").toLowerCase(),
		classes: [...bare.matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? ""),
		ids: [...bare.matchAll(/#([\w-]+)/g)].map((m) => m[1] ?? ""),
		pseudoElement,
	}
}

export function isExemptSelector(part: string): boolean {
	if (EXEMPT_STATE.test(part)) return true
	return EXEMPT_TAGS.has(parseCompound(part).tag)
}

export function selectorParts(selector: string): string[] {
	return splitTopLevel(selector, ",")
}

export function compoundCovers(general: Compound, specific: Compound): boolean {
	if (general.pseudoElement) return false
	if (general.classes.length + general.ids.length === 0 && !general.tag) return false
	if (general.tag && general.tag !== specific.tag) return false
	return (
		general.classes.every((c) => specific.classes.includes(c)) && general.ids.every((id) => specific.ids.includes(id))
	)
}
