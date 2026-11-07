import type { RankedDefinition } from "./rank"

const MAX_LINE_CHARS = 120

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

export interface RenderedMap {
	readonly text: string
	readonly tokens: number
	readonly included: readonly RankedDefinition[]
}

function renderDefinitions(definitions: readonly RankedDefinition[], sources: ReadonlyMap<string, readonly string[]>): string {
	const byFile = new Map<string, RankedDefinition[]>()
	for (const definition of definitions) {
		const list = byFile.get(definition.file) ?? []
		list.push(definition)
		byFile.set(definition.file, list)
	}
	const blocks: string[] = []
	for (const [file, list] of byFile) {
		const lines = sources.get(file) ?? []
		const body = [...list]
			.sort((a, b) => a.line - b.line)
			.map((definition) => `  ${definition.line}: ${(lines[definition.line - 1] ?? "").trim().slice(0, MAX_LINE_CHARS)}`)
		blocks.push(`${file}:\n${body.join("\n")}`)
	}
	return `${blocks.join("\n\n")}\n`
}

export function renderMap(ranked: readonly RankedDefinition[], sources: ReadonlyMap<string, readonly string[]>, budget: number): RenderedMap {
	if (ranked.length === 0) return { text: "", tokens: 0, included: [] }
	const fits = (count: number): boolean => estimateTokens(renderDefinitions(ranked.slice(0, count), sources)) <= budget
	let low = 1
	let high = ranked.length
	if (fits(high)) low = high
	else {
		while (high - low > 1) {
			const mid = Math.floor((low + high) / 2)
			if (fits(mid)) low = mid
			else high = mid
		}
	}
	const included = ranked.slice(0, low)
	const text = renderDefinitions(included, sources)
	return { text, tokens: estimateTokens(text), included }
}
