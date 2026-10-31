#!/usr/bin/env bun
// Thin CLI over the detect SDK (index.ts). Usage:
//   bun cli.ts [--json] [--reflow] [--config <file.json>] <file-or-dir-or-url>...
// Exit 0 no error or warning findings, 1 findings that fail the gate, 2 usage or render failure.
import { readFileSync } from "node:fs"
import { collectFiles } from "../perfection/collect-files"
import { type DetectConfig, detectFiles, detectPage, type Finding, formatFindingsText, hasFailures, parseConfig, RenderError, sortFindings } from "./index"

type Args = { readonly json: boolean; readonly reflow: boolean; readonly config: DetectConfig; readonly targets: readonly string[] }

function readConfig(path: string): DetectConfig | string {
	let raw: unknown
	try {
		raw = JSON.parse(readFileSync(path, "utf8"))
	} catch (error) {
		// no-excuse-ok: catch (CLI boundary: an unreadable or malformed config file is a usage error reported as exit 2)
		if (error instanceof Error) return error.message
		throw error
	}
	return parseConfig(raw)
}

function parseArgs(argv: readonly string[]): Args | string {
	let json = false
	let reflow = false
	let config: DetectConfig = {}
	const targets: string[] = []
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] ?? ""
		if (a === "--json") json = true
		else if (a === "--reflow") reflow = true
		else if (a === "--config") {
			const path = argv[++i]
			if (!path) return "--config needs a file"
			const parsed = readConfig(path)
			if (typeof parsed === "string") return `${path}: ${parsed}`
			config = parsed
		} else targets.push(a)
	}
	return targets.length === 0 ? "no targets" : { json, reflow, config, targets }
}

async function main(argv: readonly string[]): Promise<number> {
	const args = parseArgs(argv)
	if (typeof args === "string") {
		process.stderr.write(`frontend-detect: ${args}\nusage: cli.ts [--json] [--reflow] [--config <file.json>] <file-or-dir-or-url>...\n`)
		return 2
	}
	const urls = args.targets.filter((t) => /^https?:\/\//.test(t))
	const { paths, missing } = collectFiles(args.targets.filter((t) => !urls.includes(t)))
	if (missing.length > 0) {
		process.stderr.write(`frontend-detect: cannot read ${missing.join(", ")}\n`)
		return 2
	}
	const options = { config: args.config, reflow: args.reflow }
	const findings: Finding[] = [...(await detectFiles(paths, options))]
	for (const url of urls) findings.push(...(await detectPage({ kind: "url", url }, { ...options, file: url })))
	const sorted = sortFindings(findings)
	process.stdout.write(args.json ? `${JSON.stringify(sorted, null, 2)}\n` : formatFindingsText(sorted))
	return hasFailures(sorted) ? 1 : 0
}

try {
	process.exitCode = await main(process.argv.slice(2))
} catch (error) {
	// no-excuse-ok: catch (CLI boundary: a render failure is reported as exit 2, anything else propagates)
	if (!(error instanceof RenderError)) throw error
	process.stderr.write(`frontend-detect: ${error.message}\n`)
	process.exitCode = 2
}
