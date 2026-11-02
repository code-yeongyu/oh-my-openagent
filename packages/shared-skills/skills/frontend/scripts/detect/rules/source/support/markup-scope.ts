import { jsPunctuation } from "./js-punctuation"

export function tagAt(text: string, index: number): string {
	for (const m of text.matchAll(/<[a-z][\w:.-]*(?:[^"'`{}>]|"[^"]*"|'[^']*'|`[^`]*`|\{(?:[^{}]|\{[^{}]*\})*\})*>/gi)) {
		if ((m.index ?? 0) <= index && index <= (m.index ?? 0) + m[0].length) return m[0]
	}
	return text
}

export function exclusiveScopes(text: string): readonly string[] {
	let question = -1
	let paren = 0
	let brace = 0
	let colon = -1
	let nested = 0
	let end = text.length
	for (const token of jsPunctuation(text)) {
		const sameDepth = token.paren === paren && token.brace === brace
		const isQuestion = token.ch === "?" && !/[?.]/.test(text[token.at - 1] ?? "") && !/[?.]/.test(text[token.at + 1] ?? "")
		if (colon >= 0) {
			if (token.ch === "," && sameDepth) { end = token.at; break }
		} else if (question < 0 && isQuestion) {
			question = token.at
			paren = token.paren
			brace = token.brace
		} else if (question >= 0 && isQuestion && sameDepth) nested++
		else if (question >= 0 && token.ch === ":" && sameDepth) {
			if (nested > 0) nested--
			else colon = token.at
		}
	}
	if (question < 0 || colon < 0) return [text]
	return [text.slice(question + 1, colon), text.slice(colon + 1, end)].flatMap((part) => exclusiveScopes(part).map((arm) => text.slice(0, question) + arm + text.slice(end)))
}

export function solidBackground(scope: string, gray = false): string | null {
	for (const m of scope.matchAll(/\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(\d+)\b/g)) {
		const at = m.index ?? 0
		const prefix = scope.slice(0, at).split(/\s/).at(-1) ?? ""
		const state = /(?:^|:)(?:!?hover|focus(?:-visible|-within)?|active|visited|disabled|checked|open|enabled|invalid|placeholder|group-[^:]*|peer-[^:]*|aria-[^:]*|data-[^:]*):$/.test(prefix)
		if (scope[at + m[0].length] !== "/" && !state && (!gray || Number(m[1]) >= 200)) return m[0]
	}
	return null
}
