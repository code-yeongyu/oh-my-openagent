import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { indexClaims } from "./claims-index.mjs"
import { DEFECT_CODES, FIDELITY_CODES } from "./contracts.mjs"
import { checkFidelity } from "./gates-fidelity.mjs"

type Defect = { code: string; severity: string; integrity: boolean; selector: string | null; line: number | null; message: string; hint: string }
type Result = { defects: Defect[]; gatesRun: string[] }

const FIXTURES = join(import.meta.dir, "tests", "fixtures")
const FIX = join(FIXTURES, "fidelity")
const read = (path: string) => readFileSync(path, "utf8")
const OPTIONS = {
	ledger: JSON.parse(read(join(FIX, "ledger-verify.json"))),
	sourcesDir: join(FIX, "sources"),
	claims: indexClaims(read(join(FIX, "claim-graph.md"))),
	fillMap: null,
	brief: read(join(FIXTURES, "fidelity-brief-locked.md")),
	baseDir: FIX,
}

function run(html: string, extra: Record<string, unknown> = {}): Result {
	return checkFidelity(html, { ...OPTIONS, ...extra }) as Result
}

const codes = (result: Result) => result.defects.map((defect) => defect.code)

describe("checkFidelity", () => {
	test("#given the filled good report with a locked brief #when checked #then zero defects", () => {
		expect(run(read(join(FIX, "report-good.html"))).defects).toEqual([])
	})

	test("#given the bad report #when checked #then the exact defect multiset, blockers first", () => {
		const result = run(read(join(FIX, "report-bad.html")))
		expect(codes(result)).toEqual([
			"unit_mismatch",
			"value_mismatch",
			"quote_not_verbatim",
			"unresolved_placeholder",
			"claim_status_invalid",
			"untraceable_number",
			"unbound_sentence",
		])
	})

	test("#given any defect #when emitted #then it has the check shape with severity and integrity from the contract", () => {
		for (const defect of run(read(join(FIX, "report-bad.html"))).defects) {
			expect(Object.keys(defect).sort()).toEqual(["code", "hint", "integrity", "line", "message", "selector", "severity"])
			expect(defect.severity).toBe(DEFECT_CODES[defect.code as keyof typeof DEFECT_CODES].severity)
			expect(defect.integrity).toBe(DEFECT_CODES[defect.code as keyof typeof DEFECT_CODES].integrity)
		}
	})

	test("#given an unlocked brief #when checked #then only fidelity_interview_incomplete", () => {
		const result = run(read(join(FIX, "report-bad.html")), { brief: read(join(FIXTURES, "fidelity-brief-pending.md")) })
		expect(codes(result)).toEqual(["fidelity_interview_incomplete"])
		expect(result.defects[0]?.integrity).toBe(true)
	})

	test("#given a row qualifier dropped in the report #when checked #then qualifier_dropped, and the :q rendering is clean", () => {
		const dropped = '<h2>Findings</h2><p>The span is <data class="fact" data-fact="F1" data-unit="m">320 m</data> long [S4].</p>'
		expect(codes(run(dropped))).toEqual(["qualifier_dropped"])
		expect(run(dropped.replace(">320 m<", ">up to 320 m<")).defects).toEqual([])
	})

	test("#given the gate #when it runs #then every code it reports is a fidelity code", () => {
		const { gatesRun } = run(read(join(FIX, "report-good.html")))
		expect(gatesRun.length).toBeGreaterThan(0)
		expect(gatesRun.every((code) => FIDELITY_CODES.includes(code))).toBe(true)
	})
})
