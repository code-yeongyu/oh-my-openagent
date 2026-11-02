import type { SourceHit } from "../rule"

export const extensionOf = (path: string): string => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? "").toLowerCase()

/** 1-based line and column of a string offset. */
export function positionAt(text: string, offset: number): { readonly line: number; readonly column: number } {
	let line = 1
	let lineStart = 0
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			line++
			lineStart = i + 1
		}
	}
	return { line, column: offset - lineStart + 1 }
}

export function lineAt(text: string, offset: number): string {
	const start = text.lastIndexOf("\n", offset - 1) + 1
	const end = text.indexOf("\n", offset)
	return text.slice(start, end === -1 ? text.length : end).trim().slice(0, 160)
}

/** CSS declaration blocks of a stylesheet-like text: selector plus raw body, with the body's start offset. */
export function cssBlocks(text: string): readonly { readonly selector: string; readonly body: string; readonly offset: number }[] {
	const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (c) => " ".repeat(c.length))
	const out: { selector: string; body: string; offset: number }[] = []
	for (const m of stripped.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
		if (m.index === undefined) continue
		out.push({ selector: (m[1] ?? "").trim(), body: m[2] ?? "", offset: m.index + (m[1] ?? "").length + 1 })
	}
	return out
}
