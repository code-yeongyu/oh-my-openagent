import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, resolve, sep } from "node:path"

import { GitSourceError, readLiveSource, stampSource } from "./git-source"
import { type ArtifactInfo, type SourceIdentity, type ValidationResult, validateMatrix } from "./validate-evidence-core"

/**
 * validate-evidence: check a review-work QA matrix (qa-matrix.json) and its artifacts.
 *
 *   bun validate-evidence.ts <evidence-dir> [--repo <path>] [--json]   exit 0 valid, 1 invalid, 2 usage
 *   bun validate-evidence.ts stamp --repo <path>                        print the source block + capturedAt
 */

const USAGE = [
	"usage:",
	"  bun validate-evidence.ts <evidence-dir> [--repo <path>] [--json]",
	"  bun validate-evidence.ts stamp --repo <path>",
].join("\n")

interface Options {
	readonly command: "validate" | "stamp"
	readonly evidenceDir: string | null
	readonly repo: string | null
	readonly json: boolean
}

function parseArgs(argv: readonly string[]): Options | null {
	let command: Options["command"] = "validate"
	let evidenceDir: string | null = null
	let repo: string | null = null
	let json = false
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === undefined) continue
		if (arg === "--json") json = true
		else if (arg === "--repo") {
			const value = argv[i + 1]
			if (value === undefined) return null
			repo = value
			i += 1
		} else if (arg === "stamp" && command === "validate" && evidenceDir === null) command = "stamp"
		else if (arg.startsWith("--")) return null
		else if (evidenceDir === null) evidenceDir = arg
		else return null
	}
	if (command === "stamp") return repo === null ? null : { command, evidenceDir: null, repo, json }
	return evidenceDir === null ? null : { command, evidenceDir, repo, json }
}

function artifactReader(evidenceRoot: string): (relativePath: string) => ArtifactInfo {
	const root = realpathSync(evidenceRoot)
	return (relativePath) => {
		const absolute = resolve(root, relativePath)
		const exists = existsSync(absolute)
		const realPath = exists ? realpathSync(absolute) : resolve(root, relativePath)
		const inside = realPath === root || realPath.startsWith(root + sep)
		if (!exists) return { exists, isFile: false, size: 0, inside, read: () => Buffer.alloc(0) }
		const stat = statSync(absolute)
		return { exists, isFile: stat.isFile(), size: stat.size, inside, read: () => readFileSync(absolute) }
	}
}

function printResult(result: ValidationResult, json: boolean): void {
	if (json) {
		console.log(JSON.stringify({ ok: result.ok, counts: result.counts, errors: result.errors }, null, 2))
		return
	}
	for (const error of result.errors) console.log(`${error.rowId ?? "qa-matrix.json"}: ${error.message}`)
	const verdict = result.ok ? "VALID" : "INVALID"
	console.log(`${verdict} rows=${result.counts.PASS + result.counts.FAIL + result.counts.NA} PASS=${result.counts.PASS} FAIL=${result.counts.FAIL} NA=${result.counts.NA} errors=${result.errors.length}`)
}

function runValidate(options: Options): number {
	if (options.evidenceDir === null) return 2
	const matrixPath = resolve(options.evidenceDir, "qa-matrix.json")
	if (!existsSync(matrixPath)) {
		console.log(`qa-matrix.json: not found at ${matrixPath}`)
		return 1
	}
	let document: unknown
	try {
		document = JSON.parse(readFileSync(matrixPath, "utf8"))
	} catch (error) {
		console.log(`qa-matrix.json: not valid JSON (${error instanceof Error ? error.message : String(error)})`)
		return 1
	}
	let live: SourceIdentity | undefined
	if (options.repo !== null) {
		try {
			live = readLiveSource(options.repo)
		} catch (error) {
			if (!(error instanceof GitSourceError)) throw error
			console.log(`--repo: ${error.message}`)
			return 1
		}
	}
	const context = live === undefined ? { artifact: artifactReader(dirname(matrixPath)) } : { artifact: artifactReader(dirname(matrixPath)), live }
	const result = validateMatrix(document, context)
	printResult(result, options.json)
	return result.ok ? 0 : 1
}

function runStamp(options: Options): number {
	if (options.repo === null) return 2
	try {
		console.log(JSON.stringify(stampSource(options.repo), null, 2))
		return 0
	} catch (error) {
		if (!(error instanceof GitSourceError)) throw error
		console.log(`--repo: ${error.message}`)
		return 1
	}
}

export function main(argv: readonly string[]): number {
	const options = parseArgs(argv)
	if (options === null) {
		console.error(USAGE)
		return 2
	}
	return options.command === "stamp" ? runStamp(options) : runValidate(options)
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)))
}
