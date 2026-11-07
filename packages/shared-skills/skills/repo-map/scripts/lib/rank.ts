import type { Definition } from "./tags"

export interface FileTags {
	readonly file: string
	readonly definitions: readonly Definition[]
	readonly identifiers: ReadonlyMap<string, number>
}

export interface RankOptions {
	readonly focus: ReadonlySet<string>
	readonly mentions: ReadonlySet<string>
}

export interface RankedDefinition extends Definition {
	readonly file: string
	readonly rank: number
}

interface Edge {
	readonly from: string
	readonly to: string
	readonly name: string
	readonly weight: number
}

export interface RankStats {
	readonly files: number
	readonly definitions: number
	readonly references: number
	readonly edges: number
}

const DAMPING = 0.85
const ITERATIONS = 100
const TOLERANCE = 1e-6
const COMMON_DEFINITION_FILES = 5

function looksDeliberate(name: string): boolean {
	return name.length >= 8 && (name.includes("_") || /[a-z][A-Z]/.test(name))
}

function edgeWeight(name: string, refCount: number, definerCount: number, mentions: ReadonlySet<string>): number {
	let multiplier = 1
	if (mentions.has(name)) multiplier *= 10
	if (looksDeliberate(name)) multiplier *= 10
	if (name.startsWith("_")) multiplier *= 0.1
	if (definerCount > COMMON_DEFINITION_FILES) multiplier *= 0.1
	return multiplier * Math.sqrt(refCount)
}

export function buildEdges(files: readonly FileTags[], options: RankOptions): { edges: Edge[]; references: number } {
	const definers = new Map<string, Set<string>>()
	for (const file of files) {
		for (const definition of file.definitions) {
			const set = definers.get(definition.name) ?? new Set<string>()
			set.add(file.file)
			definers.set(definition.name, set)
		}
	}
	const edges: Edge[] = []
	let references = 0
	for (const file of files) {
		for (const [name, count] of file.identifiers) {
			const targets = definers.get(name)
			if (targets === undefined) continue
			const others = [...targets].filter((target) => target !== file.file)
			if (others.length === 0) continue
			references += count
			const weight = edgeWeight(name, count, targets.size, options.mentions)
			for (const target of others) edges.push({ from: file.file, to: target, name, weight })
		}
	}
	return { edges, references }
}

export function pageRank(nodes: readonly string[], edges: readonly Edge[], personalization: ReadonlyMap<string, number>): Map<string, number> {
	const count = nodes.length
	if (count === 0) return new Map()
	const outWeight = new Map<string, number>()
	for (const edge of edges) outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) + edge.weight)
	const totalPersonal = [...personalization.values()].reduce((sum, value) => sum + value, 0)
	const teleport = (node: string): number => (totalPersonal > 0 ? (personalization.get(node) ?? 0) / totalPersonal : 1 / count)
	let ranks = new Map<string, number>(nodes.map((node) => [node, 1 / count]))
	for (let iteration = 0; iteration < ITERATIONS; iteration++) {
		const next = new Map<string, number>()
		let dangling = 0
		for (const node of nodes) if ((outWeight.get(node) ?? 0) === 0) dangling += ranks.get(node) ?? 0
		for (const node of nodes) next.set(node, (1 - DAMPING) * teleport(node) + DAMPING * dangling * teleport(node))
		for (const edge of edges) {
			const share = (ranks.get(edge.from) ?? 0) * (edge.weight / (outWeight.get(edge.from) ?? 1))
			next.set(edge.to, (next.get(edge.to) ?? 0) + DAMPING * share)
		}
		let delta = 0
		for (const node of nodes) delta += Math.abs((next.get(node) ?? 0) - (ranks.get(node) ?? 0))
		ranks = next
		if (delta < TOLERANCE) break
	}
	return ranks
}

export function rankDefinitions(files: readonly FileTags[], options: RankOptions): { ranked: RankedDefinition[]; stats: RankStats } {
	const nodes = files.map((file) => file.file)
	const { edges, references } = buildEdges(files, options)
	const personalization = new Map<string, number>()
	for (const focus of options.focus) if (nodes.includes(focus)) personalization.set(focus, 100)
	const ranks = pageRank(nodes, edges, personalization)
	const outWeight = new Map<string, number>()
	for (const edge of edges) outWeight.set(edge.from, (outWeight.get(edge.from) ?? 0) + edge.weight)
	const definitionRank = new Map<string, number>()
	for (const edge of edges) {
		const share = (ranks.get(edge.from) ?? 0) * (edge.weight / (outWeight.get(edge.from) ?? 1))
		const key = `${edge.to}\0${edge.name}`
		definitionRank.set(key, (definitionRank.get(key) ?? 0) + share)
	}
	const ranked: RankedDefinition[] = []
	let definitionCount = 0
	for (const file of files) {
		for (const definition of file.definitions) {
			definitionCount += 1
			let rank = definitionRank.get(`${file.file}\0${definition.name}`) ?? 0
			if (options.focus.has(file.file)) rank = Math.max(rank, ranks.get(file.file) ?? 0) * 20
			if (options.mentions.has(definition.name)) rank *= 10
			ranked.push({ ...definition, file: file.file, rank })
		}
	}
	ranked.sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line)
	return { ranked, stats: { files: files.length, definitions: definitionCount, references, edges: edges.length } }
}
