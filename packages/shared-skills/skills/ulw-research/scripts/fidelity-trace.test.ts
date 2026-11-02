import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { indexClaims } from "./claims-index.mjs"
import { checkFidelity } from "./gates-fidelity.mjs"

type Defect = { code: string; message: string }

const FIXTURES = join(import.meta.dir, "tests", "fixtures")
const FIX = join(FIXTURES, "fidelity")
const read = (path: string) => readFileSync(path, "utf8")
const GOOD = read(join(FIX, "report-good.html"))
const OPTIONS = {
	ledger: JSON.parse(read(join(FIX, "ledger-verify.json"))),
	sourcesDir: join(FIX, "sources"),
	claims: indexClaims(read(join(FIX, "claim-graph.md"))),
	fillMap: null,
	brief: read(join(FIXTURES, "fidelity-brief-locked.md")),
	baseDir: FIX,
}

const run = (html: string, extra: Record<string, unknown> = {}) => (checkFidelity(html, { ...OPTIONS, ...extra }) as { defects: Defect[] }).defects
const codes = (defects: Defect[]) => defects.map((defect) => defect.code)
const F1_SENTENCE = "long [S4].</p>"
const F2_FILL = [{ token: "{{F2:units_sold}}", fact_id: "F2", start: 0, end: 5, rendered: "1,237" }]

describe("fill-site trace (Markdown fill map)", () => {
	test("#given a filled 1,237 and a second bare 1,237 with no ledger row #when checked #then untraceable_number", () => {
		const html = GOOD.replace("<h2>Appendix</h2>", "<p>Revenue was 1,237 million [S4].</p>\n<h2>Appendix</h2>")
		expect(codes(run(html, { fillMap: F2_FILL }))).toEqual(["untraceable_number"])
	})

	test("#given the filled occurrence alone #when checked #then it stays traced", () => {
		const html = GOOD.replace("<h2>Appendix</h2>", "<p>Units sold were 1,237 [S4].</p>\n<h2>Appendix</h2>")
		expect(run(html, { fillMap: F2_FILL })).toEqual([])
	})

	test("#given one fill entry and two plain 1,237 sites #when checked #then the unfilled copy is untraceable_number", () => {
		const html = GOOD.replace("<h2>Appendix</h2>", "<p>Units sold were 1,237 [S4].</p>\n<p>Again, 1,237 units [S4].</p>\n<h2>Appendix</h2>")
		expect(codes(run(html, { fillMap: F2_FILL }))).toEqual(["untraceable_number"])
	})

	test("#given two fill entries for two occurrences #when checked #then both are traced", () => {
		const html = GOOD.replace("<h2>Appendix</h2>", "<p>Units sold were 1,237 [S4].</p>\n<p>Again, 1,237 units [S4].</p>\n<h2>Appendix</h2>")
		expect(run(html, { fillMap: [...F2_FILL, { ...F2_FILL[0], start: 40, end: 45 }] })).toEqual([])
	})
})

describe("verification claims are judged by their mark, not their wording", () => {
	test("#given the reviewer's prose 'as confirmed with the annual inspection report' #when checked #then no unsupported_verification", () => {
		expect(run(GOOD.replace(F1_SENTENCE, "long, as confirmed with the annual inspection report [S4].</p>"))).toEqual([])
	})

	test("#given report-good's F7 marked verified but pointed at a page-sourced row #when checked #then unsupported_verification", () => {
		expect(codes(run(GOOD.replace('value="42" data-fact="F7" data-claim-kind="verified" data-lineage="MEASURED">42 passed', 'value="320" data-fact="F1" data-unit="m" data-claim-kind="verified" data-lineage="MEASURED">up to 320 m')))).toEqual(["unsupported_verification"])
	})
})
