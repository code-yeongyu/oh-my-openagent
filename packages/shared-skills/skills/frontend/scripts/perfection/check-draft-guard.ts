#!/usr/bin/env bun
// The draft guard in one command: accent stripes plus generated-look copy and markup (promo copy, emoji icons, hype badges, vanity stats).
// Usage: bun check-draft-guard.ts [--json] <file-or-dir>...   Exit 0 clean, 1 findings, 2 usage or unreadable target.
import { readFileSync } from "node:fs"
import { RULE_MESSAGES } from "./accent-stripes/findings"
import { lintFiles, type SourceFile } from "./accent-stripes/lint"
import { collectFiles } from "./collect-files"
import { DRAFT_RULE_MESSAGES } from "./draft-guard/findings"
import { lintDraft } from "./draft-guard/lint"

const MESSAGES: Readonly<Record<string, string>> = { ...RULE_MESSAGES, ...DRAFT_RULE_MESSAGES }

function main(argv: readonly string[]): number {
	const json = argv.includes("--json")
	const targets = argv.filter((a) => a !== "--json")
	if (targets.length === 0) {
		process.stderr.write("usage: check-draft-guard.ts [--json] <file-or-dir>...\n")
		return 2
	}
	const { paths, missing } = collectFiles(targets)
	if (missing.length > 0) {
		process.stderr.write(`check-draft-guard: cannot read ${missing.join(", ")}\n`)
		return 2
	}
	const files: SourceFile[] = paths.map((path) => ({ path, text: readFileSync(path, "utf8") }))
	const findings = [...lintFiles(files), ...lintDraft(files)].sort(
		(a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
	)
	if (json) process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`)
	else {
		for (const f of findings) {
			process.stdout.write(`${f.file}:${f.line}:${f.column}  ${f.rule}  ${MESSAGES[f.rule]}\n    > ${f.excerpt}\n`)
		}
		const summary = findings.length === 0 ? "clean" : `${findings.length} finding(s); fix each before visual QA`
		process.stdout.write(`check-draft-guard: ${paths.length} file(s), ${summary}\n`)
	}
	return findings.length === 0 ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
