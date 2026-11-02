#!/usr/bin/env bun
// Records Impeccable's own BROWSER-engine findings for every upstream fixture (Apache-2.0, Copyright 2025 Paul Bakaus).
// Development tool, not shipped: loads the checkout's prebuilt in-page bundle (crates/live/assets/detect-antipatterns-browser.js)
// into each fixture in Chrome and runs its detector with visual-contrast sampling off, the deterministic mode upstream's tests use.
// The static goldens under tests/oracle/golden come from an engine with no layout, so rules that need geometry (line-length,
// straggler, unbalanced-heading, ...) read 0 there; this oracle is the reference for those.
// Usage: bun packages/shared-skills/scripts/detect-parity-oracle.ts <impeccable-checkout> <out.json> [--jobs N]
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export type OracleElement = { readonly selector: string; readonly id: string | null; readonly page: boolean; readonly types: readonly string[] }
export type OracleFixture = { readonly counts: Readonly<Record<string, number>>; readonly elements: readonly OracleElement[] }

const args = process.argv.slice(2)
const [root, out] = args
if (!root || !out || !existsSync(join(root, "crates/live/assets/detect-antipatterns-browser.js"))) {
	process.stderr.write("usage: detect-parity-oracle.ts <impeccable-checkout> <out.json> [--jobs N]\n")
	process.exit(2)
}
const jobsAt = args.indexOf("--jobs")
const jobs = jobsAt === -1 ? 6 : Math.max(1, Number(args[jobsAt + 1]) || 6)
const bundleUrl = pathToFileURL(join(root, "crates/live/assets/detect-antipatterns-browser.js")).href
const fixturesDir = join(root, "tests/fixtures/antipatterns")

const LOAD = `new Promise((resolve) => {
	window.__IMPECCABLE_CONFIG__ = { autoScan: false }
	const s = document.createElement("script")
	s.src = ${JSON.stringify(bundleUrl)}
	s.onload = () => resolve(true)
	s.onerror = () => resolve(false)
	document.head.appendChild(s)
})`
const DETECT = `window.impeccableDetectAsync({ visualContrast: false }).then((found) => JSON.stringify(found.map((e) => ({
	selector: e.selector,
	id: (e.selector && document.querySelector(e.selector) || {}).id || null,
	page: e.isPageLevel === true,
	types: e.findings.map((f) => f.type),
}))))`

const isElements = (v: unknown): v is OracleElement[] => Array.isArray(v)

async function record(fixture: string): Promise<OracleFixture> {
	const view = new Bun.WebView({ width: 1280, height: 800, backend: "chrome" })
	try {
		await view.navigate(pathToFileURL(join(fixturesDir, fixture)).href)
		await view.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true")
		if ((await view.evaluate(LOAD)) !== true) throw new Error(`could not load the upstream bundle into ${fixture}`)
		const raw: unknown = await view.evaluate(DETECT)
		const elements: unknown = typeof raw === "string" ? JSON.parse(raw) : null
		if (!isElements(elements)) throw new Error(`upstream detector returned no list for ${fixture}`)
		const counts: Record<string, number> = {}
		for (const e of elements) for (const t of e.types) counts[t] = (counts[t] ?? 0) + 1
		return { counts, elements }
	} finally {
		await view.close()
	}
}

const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith(".html")).sort()
const result: Record<string, OracleFixture> = {}
let next = 0
await Promise.all(
	Array.from({ length: jobs }, async () => {
		for (let i = next++; i < fixtures.length; i = next++) {
			const fixture = fixtures[i]
			if (fixture) result[fixture] = await record(fixture)
		}
	}),
)
writeFileSync(out, JSON.stringify(result, null, 1))
process.stdout.write(`recorded ${Object.keys(result).length} fixtures -> ${out}\n`)
