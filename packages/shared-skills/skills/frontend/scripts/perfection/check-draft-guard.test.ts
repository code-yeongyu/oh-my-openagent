import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { DraftRuleId } from "./draft-guard/findings"
import { lintDraft } from "./draft-guard/lint"

const FIXTURES = join(import.meta.dir, "fixtures", "draft-guard")
const ACCENT_FIXTURES = join(import.meta.dir, "fixtures", "accent-stripes")
const SCRIPT = join(import.meta.dir, "check-draft-guard.ts")

const EXPECTED: Readonly<Record<string, ReadonlyArray<[number, DraftRuleId]>>> = {
	"promo-copy.html": [[2, "promo-copy"], [3, "promo-copy"], [5, "promo-copy"]],
	"promo-copy.tsx": [[4, "promo-copy"], [5, "promo-copy"]],
	"emoji-icons.tsx": [[4, "emoji-icon"], [6, "emoji-icon"]],
	"vanity-stats.html": [[2, "vanity-stat"], [3, "vanity-stat"], [4, "vanity-stat"]],
	"decorative-badge.vue": [[3, "decorative-badge"], [4, "decorative-badge"]],
	"components.tsx": [
		[5, "decorative-badge"],
		[6, "decorative-badge"],
		[7, "emoji-icon"],
		[7, "decorative-badge"],
		[8, "emoji-icon"],
		[9, "emoji-icon"],
		[10, "vanity-stat"],
		[11, "vanity-stat"],
		[12, "vanity-stat"],
		[13, "promo-copy"],
	],
	"attribute-edges.html": [[2, "promo-copy"], [3, "promo-copy"], [4, "vanity-stat"], [5, "decorative-badge"], [6, "promo-copy"]],
	"jsx-edges.tsx": [[1, "promo-copy"]],
}

function lintFixture(dir: string, name: string) {
	const path = join(FIXTURES, dir, name)
	return lintDraft([{ path, text: readFileSync(path, "utf8") }])
}

describe("#given a positive fixture with a generated-look tell in its markup", () => {
	test("#then every positive fixture has an expectation", () => {
		expect(readdirSync(join(FIXTURES, "positive")).sort()).toEqual(Object.keys(EXPECTED).sort())
	})

	for (const [name, expected] of Object.entries(EXPECTED)) {
		test(`#when ${name} is linted #then it reports exactly ${expected.length} finding(s) at the expected lines`, () => {
			const findings = lintFixture("positive", name).map((f): [number, DraftRuleId] => [f.line, f.rule])
			expect(findings).toEqual([...expected])
		})
	}
})

describe("#given a negative fixture (plain copy, code, scripts, styles, comments, bound values, status badges)", () => {
	for (const name of readdirSync(join(FIXTURES, "negative"))) {
		test(`#when ${name} is linted #then it reports nothing`, () => {
			expect(lintFixture("negative", name)).toEqual([])
		})
	}
})

describe("#given a generated page written on one line", () => {
	test("#when it holds two promo phrases #then both are reported, each at its own column", () => {
		const text = "<p>Seamless sync and effortless setup</p>\n"
		const findings = lintDraft([{ path: "page.html", text }])
		expect(findings.map((f) => [f.line, f.column, f.rule])).toEqual([
			[1, text.indexOf("Seamless") + 1, "promo-copy"],
			[1, text.indexOf("effortless") + 1, "promo-copy"],
		])
	})
})

describe("#given a stylesheet", () => {
	test("#when it is linted #then text rules are not applied to CSS", () => {
		expect(lintDraft([{ path: "a.css", text: '.hero::before { content: "Unlock 🚀"; }\n' }])).toEqual([])
	})
})

describe("#given the CLI", () => {
	const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 30_000 })

	test("#when it scans the draft-guard positives #then it exits 1 and prints file:line findings", () => {
		const result = run(join(FIXTURES, "positive"))
		expect(result.status).toBe(1)
		expect(result.stdout).toMatch(/vanity-stats\.html:2:\d+ {2}vanity-stat/)
	})

	test("#when it scans an accent-stripe positive #then the accent-stripe rules still report through it", () => {
		const result = run("--json", join(ACCENT_FIXTURES, "positive", "border-top-card.css"))
		expect(JSON.parse(result.stdout)).toEqual([expect.objectContaining({ line: 4, rule: "edge-stripe" })])
		expect(result.status).toBe(1)
	})

	test("#when it scans both negative fixture sets #then it exits 0", () => {
		expect(run(join(FIXTURES, "negative"), join(ACCENT_FIXTURES, "negative")).status).toBe(0)
	})

	test("#when no path is given #then it exits 2 with usage", () => {
		const result = run()
		expect(result.status).toBe(2)
		expect(result.stderr).toContain("usage:")
	})
})
