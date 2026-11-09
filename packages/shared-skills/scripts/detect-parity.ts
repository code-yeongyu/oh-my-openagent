#!/usr/bin/env bun
// Parity check of the frontend detect SDK against Impeccable's own fixtures and oracle goldens (Apache-2.0, Copyright 2025 Paul Bakaus).
// Development tool, not shipped: needs a local checkout of https://github.com/pbakaus/impeccable and a browser.
// Usage: bun packages/shared-skills/scripts/detect-parity.ts <impeccable-checkout> [--rules id,id] [--backend chrome|webkit] [--json out.json] [--oracle browser.json]
// For each fixture it renders the page, runs our rules, and compares (1) per-rule finding counts with the golden
// `detect-fixture-json-*` output, or with the browser-engine record from detect-parity-oracle.ts when --oracle is given, and (2) the fixture's own flag-N / pass-N element ids for the rule the fixture is named after.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { lintSnapshot } from "../skills/frontend/scripts/detect/lint"
import { createWebViewRenderer } from "../skills/frontend/scripts/detect/render/webview"
import { ALL_RULES } from "../skills/frontend/scripts/detect/rules"
import type { Finding } from "../skills/frontend/scripts/detect/types"

type Golden = { readonly stdout: string }
type GoldenFinding = { readonly antipattern: string }
type Row = { fixture: string; rule: string; golden: number; ours: number; flagMissed: string[]; passHit: string[] }

const args = process.argv.slice(2)
const root = args[0]
if (!root || !existsSync(join(root, "tests/fixtures/antipatterns"))) {
	process.stderr.write("usage: detect-parity.ts <impeccable-checkout> [--rules a,b] [--backend chrome|webkit] [--json out.json]\n")
	process.exit(2)
}
const flag = (name: string): string | undefined => {
	const i = args.indexOf(name)
	return i === -1 ? undefined : args[i + 1]
}
const backend = flag("--backend") === "webkit" ? "webkit" : "chrome"
const only = flag("--rules")?.split(",")
const rules = only ? ALL_RULES.filter((r) => only.includes(r.meta.id)) : ALL_RULES
const ruleIds = new Set(rules.map((r) => r.meta.id))
const fixturesDir = join(root, "tests/fixtures/antipatterns")
const goldenDir = join(root, "tests/oracle/golden")

const oraclePath = flag("--oracle")
const oracle: unknown = oraclePath ? JSON.parse(readFileSync(oraclePath, "utf8")) : null

const oracleCounts = (fixture: string): Map<string, number> | null => {
	const entry: unknown = typeof oracle === "object" && oracle !== null ? Reflect.get(oracle, fixture) : undefined
	const counts: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "counts") : undefined
	if (typeof counts !== "object" || counts === null) return null
	return new Map(Object.entries(counts).filter((kv): kv is [string, number] => typeof kv[1] === "number"))
}

const goldenCounts = (fixture: string): Map<string, number> | null => {
	if (oracle !== null) return oracleCounts(fixture)
	const path = join(goldenDir, `detect-fixture-json-${fixture.replace(/\./g, "-")}.json`)
	if (!existsSync(path)) return null
	const golden: Golden = JSON.parse(readFileSync(path, "utf8"))
	const parsed: unknown = golden.stdout.trim() === "" ? [] : JSON.parse(golden.stdout)
	const counts = new Map<string, number>()
	const isGoldenFinding = (v: unknown): v is GoldenFinding => typeof v === "object" && v !== null && typeof Reflect.get(v, "antipattern") === "string"
	if (Array.isArray(parsed)) {
		for (const f of parsed.filter(isGoldenFinding)) counts.set(f.antipattern, (counts.get(f.antipattern) ?? 0) + 1)
	}
	return counts
}

const fixtureRule = (fixture: string): string | undefined =>
	[...ruleIds].sort((a, b) => b.length - a.length).find((id) => fixture.startsWith(id))

const elementIdOf = (f: Finding): string => (f.location.kind === "element" ? f.location.selector : "")

const renderer = createWebViewRenderer({ backend })
const rows: Row[] = []
try {
	for (const fixture of readdirSync(fixturesDir).filter((f) => f.endsWith(".html")).sort()) {
		const golden = goldenCounts(fixture)
		const owner = fixtureRule(fixture)
		if (!golden && !owner) continue
		const html = readFileSync(join(fixturesDir, fixture), "utf8")
		const snapshot = await renderer.render({ target: { kind: "url", url: pathToFileURL(join(fixturesDir, fixture)).href }, viewport: { width: 1280, height: 800 } })
		const findings = lintSnapshot(snapshot, { rules })
		for (const id of ruleIds) {
			const ours = findings.filter((f) => f.ruleId === id)
			const goldenN = golden?.get(id) ?? 0
			const flagIds = id === owner ? [...html.matchAll(/id="(flag-[^"]+)"/g)].map((m) => m[1] ?? "") : []
			const passIds = id === owner ? [...html.matchAll(/id="(pass-[^"]+)"/g)].map((m) => m[1] ?? "") : []
			const hitSelectors = ours.map(elementIdOf)
			const flagMissed = flagIds.filter((fid) => !hitSelectors.some((s) => s.includes(`#${fid}`)))
			const passHit = passIds.filter((pid) => hitSelectors.some((s) => s === `#${pid}` || s.startsWith(`#${pid} `)))
			if (goldenN === 0 && ours.length === 0 && flagIds.length === 0) continue
			rows.push({ fixture, rule: id, golden: goldenN, ours: ours.length, flagMissed, passHit })
		}
	}
} finally {
	await renderer.close()
}

const byRule = new Map<string, { fixtures: number; countMatch: number; idClean: number; idFixtures: number }>()
for (const r of rows) {
	const s = byRule.get(r.rule) ?? { fixtures: 0, countMatch: 0, idClean: 0, idFixtures: 0 }
	s.fixtures++
	if (r.golden === r.ours) s.countMatch++
	if (r.flagMissed.length > 0 || r.passHit.length > 0 || r.fixture.startsWith(r.rule)) {
		s.idFixtures++
		if (r.flagMissed.length === 0 && r.passHit.length === 0) s.idClean++
	}
	byRule.set(r.rule, s)
}
for (const [rule, s] of [...byRule].sort()) {
	process.stdout.write(`${rule.padEnd(34)} golden-count ${s.countMatch}/${s.fixtures}  flag/pass ids ${s.idClean}/${s.idFixtures}\n`)
}
for (const r of rows.filter((x) => x.golden !== x.ours || x.flagMissed.length > 0 || x.passHit.length > 0)) {
	process.stdout.write(`  MISMATCH ${r.rule} ${r.fixture}: golden ${r.golden} ours ${r.ours}${r.flagMissed.length ? ` missed ${r.flagMissed.join(",")}` : ""}${r.passHit.length ? ` false+ ${r.passHit.join(",")}` : ""}\n`)
}
const out = flag("--json")
if (out) writeFileSync(out, JSON.stringify({ backend, rows }, null, 2))
