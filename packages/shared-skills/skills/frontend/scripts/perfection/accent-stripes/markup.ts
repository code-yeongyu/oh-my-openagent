import type { Declaration } from "./css-parse"
import { looksLikeClassList } from "./tailwind"

export type ClassGroup = { readonly tokens: readonly string[]; readonly offset: number }
export type InlineStyle = { readonly declarations: readonly Declaration[]; readonly offset: number; readonly tagRounded: boolean }
export type StyleBlock = { readonly css: string; readonly offset: number }

const UNITLESS = new Set(["opacity", "z-index", "flex", "flex-grow", "flex-shrink", "font-weight", "line-height", "order"])
const ROUNDED_CLASS = /(?:^|[\s"'`:])rounded(?:-(?!none\b)[\w[\]./-]+)?(?=[\s"'`]|$)/

export function styleBlocks(text: string): StyleBlock[] {
	return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => ({
		css: m[1] ?? "",
		offset: (m.index ?? 0) + m[0].indexOf(">") + 1,
	}))
}

const CSS_TEMPLATE_TAG = /(?:\bstyled(?:\.\w+|\([^()]*\))(?:\.attrs\([^)]*\))?|\bcss|\bcreateGlobalStyle|\binjectGlobal|<style[^>]*>\s*\{)\s*$/
const CSS_TEMPLATE_HOST = ".css-in-js-host"

function blankInterpolations(body: string): string {
	let out = ""
	let depth = 0
	for (let i = 0; i < body.length; i += 1) {
		const ch = body.charAt(i)
		if (depth === 0 && ch === "$" && body.charAt(i + 1) === "{") {
			depth = 1
			out += "  "
			i += 1
		} else if (depth > 0) {
			if (ch === "{") depth += 1
			else if (ch === "}") depth -= 1
			out += ch === "\n" ? "\n" : " "
		} else out += ch
	}
	return out
}

export function cssTemplates(text: string): StyleBlock[] {
	const blocks: StyleBlock[] = []
	for (const m of text.matchAll(/`((?:\\.|[^`\\])*)`/g)) {
		const start = m.index ?? 0
		if (!CSS_TEMPLATE_TAG.test(text.slice(Math.max(0, start - 120), start))) continue
		const prefix = `${CSS_TEMPLATE_HOST}{`
		blocks.push({ css: `${prefix}${blankInterpolations(m[1] ?? "")}}`, offset: start + 1 - prefix.length })
	}
	return blocks
}

function stripInterpolation(literal: string): string {
	return literal.replace(/\$\{[^}]*\}/g, " ")
}

function tokensOf(text: string): string[] {
	return text.split(/\s+/).filter(Boolean)
}

function readBalanced(text: string, start: number): { end: number; literals: string[] } {
	const literals: string[] = []
	let depth = 0
	for (let i = start; i < text.length; i += 1) {
		const ch = text.charAt(i)
		if (ch === '"' || ch === "'" || ch === "`") {
			const close = text.indexOf(ch, i + 1)
			if (close < 0) return { end: text.length, literals }
			literals.push(stripInterpolation(text.slice(i + 1, close)))
			i = close
		} else if (ch === "{") depth += 1
		else if (ch === "}") {
			depth -= 1
			if (depth === 0) return { end: i + 1, literals }
		}
	}
	return { end: text.length, literals }
}

export function classGroups(text: string, scanLiterals: boolean): ClassGroup[] {
	const groups: ClassGroup[] = []
	const covered: Array<[number, number]> = []
	for (const m of text.matchAll(/(?:^|[\s{(,])(?::class|class:list|className|class|tw)\s*=\s*/g)) {
		const start = (m.index ?? 0) + m[0].length
		const ch = text.charAt(start)
		if (ch === '"' || ch === "'") {
			const close = text.indexOf(ch, start + 1)
			if (close < 0) continue
			groups.push({ tokens: tokensOf(text.slice(start + 1, close)), offset: start })
			covered.push([start, close])
		} else if (ch === "{") {
			const { end, literals } = readBalanced(text, start)
			groups.push({ tokens: literals.flatMap(tokensOf), offset: start })
			covered.push([start, end])
		}
	}
	if (!scanLiterals) return groups
	for (const m of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
		const offset = m.index ?? 0
		if (covered.some(([a, b]) => offset >= a && offset <= b)) continue
		const body = stripInterpolation(m[2] ?? "")
		if (looksLikeClassList(body)) groups.push({ tokens: tokensOf(body), offset })
	}
	return groups
}

function kebab(key: string): string {
	return key.replace(/^["']|["']$/g, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

function objectDeclarations(source: string): Declaration[] {
	const pattern = /([A-Za-z]+|"[\w-]+"|'[\w-]+')\s*:\s*("[^"]*"|'[^']*'|`[^`$]*`|-?\d+(?:\.\d+)?)/g
	return [...source.matchAll(pattern)].map((m) => {
		const prop = kebab(m[1] ?? "")
		const raw = m[2] ?? ""
		const numeric = /^-?\d/.test(raw)
		const value = numeric ? (UNITLESS.has(prop) ? raw : `${raw}px`) : raw.slice(1, -1)
		return { prop, value }
	})
}

function cssDeclarations(source: string): Declaration[] {
	return source
		.split(";")
		.map((d) => d.split(/:(.*)/s))
		.filter((p): p is [string, string, ...string[]] => p.length >= 2 && Boolean(p[0]?.trim()))
		.map(([prop, value]) => ({ prop: prop.trim().toLowerCase(), value: value.trim() }))
}

function tagIsRounded(text: string, offset: number, end: number): boolean {
	const open = text.lastIndexOf("<", offset)
	const close = text.indexOf(">", end)
	if (open < 0) return false
	return ROUNDED_CLASS.test(text.slice(open, close < 0 ? end : close))
}

export function inlineStyles(text: string): InlineStyle[] {
	const styles: InlineStyle[] = []
	for (const m of text.matchAll(/\bstyle\s*=\s*\{\{([\s\S]*?)\}\}/g)) {
		const offset = m.index ?? 0
		const end = offset + m[0].length
		styles.push({ declarations: objectDeclarations(m[1] ?? ""), offset, tagRounded: tagIsRounded(text, offset, end) })
	}
	for (const m of text.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/g)) {
		const offset = m.index ?? 0
		const body = (m[2] ?? "").trim()
		const declarations = body.startsWith("{") ? objectDeclarations(body) : cssDeclarations(body)
		styles.push({ declarations, offset, tagRounded: tagIsRounded(text, offset, offset + m[0].length) })
	}
	return styles
}
