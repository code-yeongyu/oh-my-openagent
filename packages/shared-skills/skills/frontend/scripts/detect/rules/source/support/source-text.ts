import { extensionOf, lineAt, positionAt } from "../../../core/source"
import type { SourceContext, SourceHit } from "../../../rule"

export const sourceExtensions = ["css", "scss", "sass", "less", "js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "astro"]
export const componentExtensions = ["vue", "svelte", "astro"]
export const sheetExtensions = ["css", "scss", "sass", "less"]
export type SourcePass = { readonly text: string; readonly offset: number; readonly css: boolean; readonly sass: boolean }
export type LineMatch = {
	readonly match: RegExpMatchArray
	readonly line: string
	readonly scope: string
	readonly offset: number
	readonly pass: SourcePass
	readonly source: string
	readonly context: SourceContext
}

const blank = (text: string): string => text.replace(/[^\n\r]/g, " ")

export function stripComments(text: string, script: boolean): string {
	let out = ""
	let quote = ""
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? ""
		const next = text[i + 1]
		if (quote) {
			out += ch
			if (ch === "\\") out += text[++i] ?? ""
			else if (ch === quote) quote = ""
			continue
		}
		if (ch === '"' || ch === "'" || (script && ch === "`")) {
			quote = ch
			out += ch
		} else if (ch === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2)
			const stop = end < 0 ? text.length : end + 2
			out += blank(text.slice(i, stop))
			i = stop - 1
		} else if (ch === "/" && next === "/" && text[i - 1] !== ":") {
			const end = text.indexOf("\n", i)
			const stop = end < 0 ? text.length : end
			out += blank(text.slice(i, stop))
			i = stop - 1
		} else if (text.startsWith("<!--", i)) {
			const end = text.indexOf("-->", i + 4)
			const stop = end < 0 ? text.length : end + 3
			out += blank(text.slice(i, stop))
			i = stop - 1
		} else out += ch
	}
	return out
}

export function sourcePasses(context: SourceContext): readonly SourcePass[] {
	const ext = extensionOf(context.file.path)
	const css = sheetExtensions.includes(ext)
	const text = stripComments(context.file.text, !css)
	const passes: SourcePass[] = [{ text, offset: 0, css, sass: ext === "sass" }]
	if (componentExtensions.includes(ext)) {
		for (const m of text.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)) {
			const body = m[2] ?? ""
			passes.push({ text: stripComments(body, false), offset: (m.index ?? 0) + m[0].indexOf(">") + 1, css: true, sass: /\blang\s*=\s*["']sass["']/.test(m[1] ?? "") })
		}
	}
	if (["js", "jsx", "ts", "tsx"].includes(ext)) {
		for (const m of text.matchAll(/(?:\bstyled(?:\s*\([^`]*?\)|\.[\w.]+)(?:\([^`]*?\))?|\bcss|\bcreateGlobalStyle|<style\s+jsx[^>]*>\s*\{)\s*`([\s\S]*?)`/g)) {
			const body = m[1] ?? ""
			passes.push({ text: stripComments(body, false), offset: (m.index ?? 0) + m[0].indexOf("`") + 1, css: true, sass: false })
		}
	}
	let source = text
	for (const pass of passes.slice(1)) source = source.slice(0, pass.offset) + pass.text + source.slice(pass.offset + pass.text.length)
	return [{ text: source, offset: 0, css, sass: ext === "sass" }, ...passes.slice(1)]
}

export function sourceHit(text: string, offset: number, message: string, snippet = lineAt(text, offset)): SourceHit {
	return { ...positionAt(text, offset), message, snippet }
}

export function lineCheck(patterns: readonly RegExp[], test: (match: LineMatch) => string | null): (context: SourceContext) => readonly SourceHit[] {
	return (context) => {
		const hits: SourceHit[] = []
		for (const pass of sourcePasses(context)) {
			const lines = pass.text.split("\n")
			let start = 0
			for (const [i, line] of lines.entries()) {
				const scope = pass.css ? lines.slice(Math.max(0, i - 3), i + 4).join(" ") : line
				for (const pattern of patterns) {
					for (const match of line.matchAll(pattern)) {
						const offset = start + (match.index ?? 0)
						const message = test({ match, line, scope, offset, pass, source: pass.text, context })
						if (message === null) continue
						const hit = sourceHit(context.file.text, pass.offset + offset, message, message)
						if (!hits.some((h) => h.snippet === hit.snippet && Math.abs(h.line - hit.line) <= 2)) hits.push(hit)
					}
				}
				start += line.length + 1
			}
		}
		return hits
	}
}

export function pageSource(context: SourceContext): string | null {
	if (!componentExtensions.includes(extensionOf(context.file.path))) return null
	return /<!doctype\s|<html[\s>]|<head[\s>]/i.test(context.file.text.replace(/<!--[\s\S]*?-->/g, "")) ? context.file.text : null
}

export const bodyText = (text: string): string => text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
