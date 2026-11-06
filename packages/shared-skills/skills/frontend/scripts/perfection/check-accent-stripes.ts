#!/usr/bin/env bun
// Flags coloured one-side bars on any box and accent outlines on rounded cards in CSS, Tailwind and JSX.
// Usage: bun check-accent-stripes.ts [--json] <file-or-dir>...   Exit 0 clean, 1 findings, 2 usage or unreadable target.
import { readFileSync } from "node:fs"
import { FIX_HINT, RULE_MESSAGES } from "./accent-stripes/findings"
import { lintFiles, type SourceFile } from "./accent-stripes/lint"
import { collectFiles } from "./collect-files"

function main(argv: readonly string[]): number {
	const json = argv.includes("--json")
	const targets = argv.filter((a) => a !== "--json")
	if (targets.length === 0) {
		process.stderr.write("usage: check-accent-stripes.ts [--json] <file-or-dir>...\n")
		return 2
	}
	const { paths, missing } = collectFiles(targets)
	if (missing.length > 0) {
		process.stderr.write(`check-accent-stripes: cannot read ${missing.join(", ")}\n`)
		return 2
	}
	const files: SourceFile[] = paths.map((path) => ({ path, text: readFileSync(path, "utf8") }))
	const findings = lintFiles(files)
	if (json) process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`)
	else {
		for (const f of findings) {
			process.stdout.write(`${f.file}:${f.line}:${f.column}  ${f.rule}  ${RULE_MESSAGES[f.rule]}\n    > ${f.excerpt}\n`)
		}
		const summary = findings.length === 0 ? "no accent stripes" : `${findings.length} accent stripe(s); ${FIX_HINT}`
		process.stdout.write(`check-accent-stripes: ${paths.length} file(s), ${summary}\n`)
	}
	return findings.length === 0 ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
