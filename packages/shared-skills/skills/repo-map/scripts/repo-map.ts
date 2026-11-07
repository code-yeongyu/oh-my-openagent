import { readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

import { discoverFiles } from "./lib/files"
import { type FileTags, rankDefinitions } from "./lib/rank"
import { renderMap } from "./lib/render"
import { extractDefinitions, extractIdentifiers, languageFor } from "./lib/tags"

/**
 * repo-map: a ranked map of a repository's definitions within a token budget.
 *
 *   bun repo-map.ts [paths...] [--budget N] [--focus <path>]... [--mention <ident>]... [--json] [--verbose]
 *
 * Exit codes: 0 map printed, 1 no mappable files, 2 usage.
 */

const USAGE = "usage: bun repo-map.ts [paths...] [--budget N] [--focus <path>]... [--mention <ident>]... [--json] [--verbose]"
const DEFAULT_BUDGET = 4096

interface Options {
	readonly paths: readonly string[]
	readonly budget: number
	readonly focus: readonly string[]
	readonly mentions: readonly string[]
	readonly json: boolean
	readonly verbose: boolean
}

function parseArgs(argv: readonly string[]): Options | null {
	const paths: string[] = []
	const focus: string[] = []
	const mentions: string[] = []
	let budget = DEFAULT_BUDGET
	let json = false
	let verbose = false
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === undefined) continue
		if (arg === "--json") json = true
		else if (arg === "--verbose") verbose = true
		else if (arg === "--budget" || arg === "--focus" || arg === "--mention") {
			const value = argv[i + 1]
			if (value === undefined) return null
			i += 1
			if (arg === "--focus") focus.push(value)
			else if (arg === "--mention") mentions.push(value)
			else {
				const parsed = Number(value)
				if (!Number.isInteger(parsed) || parsed <= 0) return null
				budget = parsed
			}
		} else if (arg.startsWith("--")) return null
		else paths.push(arg)
	}
	return { paths: paths.length > 0 ? paths : ["."], budget, focus, mentions, json, verbose }
}

function toRelative(cwd: string, path: string): string {
	return relative(cwd, path).replaceAll("\\", "/")
}

function tagFiles(cwd: string, files: readonly string[], sources: Map<string, readonly string[]>): FileTags[] {
	const tagged: FileTags[] = []
	for (const absolute of files) {
		const language = languageFor(absolute)
		if (language === null) continue
		let source: string
		try {
			source = readFileSync(absolute, "utf8")
		} catch {
			continue
		}
		const file = toRelative(cwd, absolute)
		sources.set(file, source.split("\n"))
		tagged.push({ file, definitions: extractDefinitions(source, language), identifiers: extractIdentifiers(source, language) })
	}
	return tagged
}

export function main(argv: readonly string[], cwd: string = process.cwd()): number {
	const options = parseArgs(argv)
	if (options === null) {
		console.error(USAGE)
		return 2
	}
	const files = discoverFiles(options.paths, cwd)
	if (files.length === 0) {
		console.error(`repo-map: no mappable source files under ${options.paths.join(", ")}`)
		return 1
	}
	const sources = new Map<string, readonly string[]>()
	const tagged = tagFiles(cwd, files, sources)
	const focus = new Set(options.focus.map((path) => toRelative(cwd, isAbsolute(path) ? path : resolve(cwd, path))))
	const { ranked, stats } = rankDefinitions(tagged, { focus, mentions: new Set(options.mentions) })
	const rendered = renderMap(ranked, sources, options.budget)
	if (options.verbose) console.error(`repo-map: files=${stats.files} definitions=${stats.definitions} references=${stats.references} edges=${stats.edges} shown=${rendered.included.length} tokens=${rendered.tokens}/${options.budget}`)
	if (options.json) {
		console.log(JSON.stringify({ files: stats.files, budget: options.budget, tokens: rendered.tokens, definitions: rendered.included }, null, 2))
	} else process.stdout.write(rendered.text)
	return 0
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)))
}
