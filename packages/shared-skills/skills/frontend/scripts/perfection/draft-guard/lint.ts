import { lineLocator } from "../accent-stripes/findings"
import type { SourceFile } from "../accent-stripes/lint"
import type { DraftFinding } from "./findings"
import { checkNode } from "./rules"
import { type MarkupKind, textNodes } from "./text-nodes"

function markupKind(path: string): MarkupKind | null {
	if (/\.html?$/i.test(path)) return "html"
	if (/\.[cm]?[jt]sx$/i.test(path)) return "jsx"
	if (/\.(?:vue|svelte|astro)$/i.test(path)) return "sfc"
	return null
}

function excerptAt(text: string, offset: number): string {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1
	const lineEnd = text.indexOf("\n", offset)
	return text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim().slice(0, 140)
}

export function lintDraft(files: readonly SourceFile[]): DraftFinding[] {
	const findings: DraftFinding[] = []
	for (const file of files) {
		const kind = markupKind(file.path)
		if (kind === null) continue
		const locate = lineLocator(file.text)
		const seen = new Set<string>()
		for (const node of textNodes(file.text, kind)) {
			for (const hit of checkNode(node)) {
				const at = locate(hit.offset)
				const key = `${hit.offset}:${hit.rule}`
				if (seen.has(key)) continue
				seen.add(key)
				findings.push({ file: file.path, ...at, rule: hit.rule, excerpt: excerptAt(file.text, hit.offset) })
			}
		}
	}
	return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
}
