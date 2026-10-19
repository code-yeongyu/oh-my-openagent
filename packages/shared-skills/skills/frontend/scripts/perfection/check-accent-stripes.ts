#!/usr/bin/env bun
// Flags the "coloured accent edge on a rounded card" slop tell in CSS, Tailwind and JSX.
// Usage: bun check-accent-stripes.ts [--json] <file-or-dir>...   Exit 0 clean, 1 findings, 2 usage.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { FIX_HINT, RULE_MESSAGES } from "./accent-stripes/findings"
import { lintFiles, type SourceFile } from "./accent-stripes/lint"

const SCANNED = /\.(?:css|scss|less|pcss|postcss|html?|[cm]?[jt]sx?|vue|svelte|astro)$/i
const SKIPPED_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".astro",
	".turbo", ".cache", "coverage", "vendor", ".vercel", ".output",
])
const MAX_BYTES = 1_000_000

function collect(path: string, into: string[]): void {
	const stat = statSync(path)
	if (stat.isDirectory()) {
		for (const entry of readdirSync(path)) {
			if (!SKIPPED_DIRS.has(entry)) collect(join(path, entry), into)
		}
		return
	}
	const minified = /\.min\.[a-z]+$/i.test(path) || path.endsWith(".d.ts")
	if (SCANNED.test(path) && !minified && stat.size <= MAX_BYTES) into.push(path)
}

function main(argv: readonly string[]): number {
	const json = argv.includes("--json")
	const targets = argv.filter((a) => a !== "--json")
	if (targets.length === 0) {
		process.stderr.write("usage: check-accent-stripes.ts [--json] <file-or-dir>...\n")
		return 2
	}
	const paths: string[] = []
	for (const target of targets) collect(target, paths)
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
