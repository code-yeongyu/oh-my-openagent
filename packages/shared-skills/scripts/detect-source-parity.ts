#!/usr/bin/env bun
// Source-engine parity check of the frontend detect SDK against Impeccable's fixtures and static goldens (Apache-2.0, Copyright 2025 Paul Bakaus).
// Development tool, not shipped: needs a local checkout of https://github.com/pbakaus/impeccable.
import { lintSources } from "../skills/frontend/scripts/detect/lint"
import { SOURCE_RULES } from "../skills/frontend/scripts/detect/rules/source"

type GoldenFinding = { readonly antipattern: string; readonly snippet: string; readonly file: string; readonly line: number }

function goldenRows(value: unknown): readonly GoldenFinding[] {
	if (typeof value !== "object" || value === null || !("stdout" in value) || typeof value.stdout !== "string") return []
	const rows: unknown = JSON.parse(value.stdout)
	if (!Array.isArray(rows)) return []
	return rows.flatMap((row: unknown) => {
		if (typeof row !== "object" || row === null || !("antipattern" in row) || !("snippet" in row) || !("file" in row) || !("line" in row)) return []
		if (typeof row.antipattern !== "string" || typeof row.snippet !== "string" || typeof row.file !== "string" || typeof row.line !== "number") return []
		return [{ antipattern: row.antipattern, snippet: row.snippet, file: row.file, line: row.line }]
	})
}

async function fixtureParity(upstream: string): Promise<readonly object[]> {
	const root = `${upstream}/tests/fixtures/antipatterns`
	const paths = [...new Bun.Glob("**/*").scanSync(root)].filter((p) => /\.(css|scss|sass|less|tsx|jsx|vue|svelte|astro|js|ts|mjs|cjs)$/.test(p)).sort()
	const files = await Promise.all(paths.map(async (path) => ({ path, text: await Bun.file(`${root}/${path}`).text() })))
	const reports: object[] = []
	const targets = [...paths.filter((p) => !p.includes("/")), ...new Set(paths.filter((p) => p.includes("/")).map((p) => p.split("/")[0] ?? ""))]
	for (const target of targets) {
		const selected = files.filter((f) => f.path === target || f.path.startsWith(`${target}/`))
		const actual = lintSources(selected, { rules: SOURCE_RULES })
		const goldenPath = `${upstream}/tests/oracle/golden/detect-fixture-json-${target.replaceAll(".", "-")}.json`
		if (!await Bun.file(goldenPath).exists()) {
			reports.push({ fixture: target, golden: "absent", findings: actual.length })
			continue
		}
		const expected = goldenRows(await Bun.file(goldenPath).json())
		const counts = SOURCE_RULES.map((rule) => ({
			rule: rule.meta.id,
			actual: actual.filter((f) => f.ruleId === rule.meta.id).length,
			expected: expected.filter((f) => f.antipattern === rule.meta.id).length,
		}))
		reports.push({
			fixture: target,
			matching: counts.every((c) => c.actual === c.expected),
			counts: counts.filter((c) => c.actual > 0 || c.expected > 0),
			locations: actual.map((f) => ({ rule: f.ruleId, location: f.location, snippet: f.snippet })),
		})
	}
	return reports
}

if (import.meta.main) {
	const upstream = process.argv[2]
	if (!upstream) throw new TypeError("An upstream checkout path is required")
	const reports = await fixtureParity(upstream)
	console.log(JSON.stringify(process.argv.includes("--locations") ? reports : reports.map((report) => {
		if ("fixture" in report && "matching" in report && "counts" in report) return { fixture: report.fixture, matching: report.matching, counts: report.counts }
		return report
	}), null, 2))
}
