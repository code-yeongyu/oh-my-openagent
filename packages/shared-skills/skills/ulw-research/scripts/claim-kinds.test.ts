import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { CLAIM_ATTRIBUTE, CLAIM_KINDS, CLAIM_TABLE_BEGIN, CLAIM_TABLE_END, renderClaimKindTable, unmarkedKinds } from "./claim-kinds.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { valueChecks } from "./fidelity-values.mjs"
import { buildContext } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"

// Protects the claim-kind contract the writer (fill) and the gate share: a fact marked with a
// claim kind must cite a row that kind accepts, a mark binds only the facts it owns, and the doc
// table writers read is rendered from CLAIM_KINDS. Expectations come from ORACLE below, written by
// hand from the design, never from the table under test.

type Defect = { code: string; severity: string }
type Row = Record<string, unknown> & { fact_id: string; kind: string; source_id: string | null; raw?: string; quote?: string }

const FIX = join(import.meta.dir, "tests", "fixtures", "fidelity")
const BASE: { rows: Row[] } = JSON.parse(readFileSync(join(FIX, "ledger-verify.json"), "utf8"))
const byId = (id: string) => BASE.rows.find((row) => row.fact_id === id) as Row
const [F1, F7, F8, Q1] = ["F1", "F7", "F8", "Q1"].map(byId) as [Row, Row, Row, Row]
const plain = { render: null, operation: null, operands: [], derived_from: [], formula: null, factor: null }
const F9: Row = { ...F8, ...plain, fact_id: "F9", kind: "assumed", label: "growth_rate", raw: "15%", value: "15", unit: "%", exact: { num: "15", den: "1" }, rationale: "planning assumption" }
const F10: Row = { ...F8, ...plain, fact_id: "F10", kind: "derived", label: "share_sum", raw: "39%", value: "39", unit: "%", exact: { num: "39", den: "1" }, operation: "sum", operands: ["F5", "F6"] }
const F11: Row = { ...F7, fact_id: "F11", locator: null }
const F12: Row = { ...F7, fact_id: "F12", locator: { artifact: "missing.txt", char_start: 0, char_end: 9 } }
const F13: Row = { ...F7, fact_id: "F13", locator: { artifact: "../S4/text.txt", char_start: 0, char_end: 9 } }
const LEDGER = { ...BASE, rows: [...BASE.rows, F9, F10, F11, F12, F13] }
const SUBJECTS = [F1, F7, F8, F9, F10, F11, F12, F13, Q1]

/** Hand-written oracle: the ledger row kinds each claim kind accepts, and whether the cited row must be command-backed. */
const ORACLE: Record<string, { rows: string[]; command: boolean }> = {
	fact: { rows: ["measured", "converted", "derived"], command: false },
	quote: { rows: ["quote"], command: false },
	verified: { rows: ["measured", "quote"], command: true },
	derived: { rows: ["derived", "converted"], command: false },
	assumed: { rows: ["assumed"], command: false },
}
/** Rows an unmarked element refuses (an unmarked numeral reads as a fact, so an assumption needs its A mark). */
const UNMARKED_REFUSED = new Set(["F9"])
/** Rows whose own locator artifact sits in a snapshot whose meta.json kind is command (S5/text.txt). */
const COMMAND_BACKED = new Set(["F7"])
const MAJOR_FOR: Record<string, string> = { fact: "claim_kind_mismatch", quote: "claim_kind_mismatch", verified: "unsupported_verification", derived: "claim_kind_mismatch", assumed: "claim_kind_mismatch" }
const expected = (kind: string, row: Row) => {
	const rule = ORACLE[kind] as { rows: string[]; command: boolean }
	return rule.rows.includes(row.kind) && (!rule.command || COMMAND_BACKED.has(row.fact_id)) ? [] : [MAJOR_FOR[kind] as string]
}

const CLAIM_CODES = new Set(["claim_kind_mismatch", "unsupported_verification", "verification_claim_unmarked"])
const run = (body: string) => valueChecks(buildContext(parseHtml(`<h2>Findings</h2>\n${body}`), { baseDir: FIX }), LEDGER, null, join(FIX, "sources"), {}) as Defect[]
const claims = (body: string) => run(body).filter((d) => CLAIM_CODES.has(d.code))
const codes = (body: string) => claims(body).map((d) => d.code).sort()

const value = (row: Row, kind?: string) => {
	const mark = kind ? ` ${CLAIM_ATTRIBUTE}="${kind}"` : ""
	return row.kind === "quote" ? `<q data-fact="${row.fact_id}"${mark} data-quote-sel="full">${row.quote}</q>` : `<data class="fact"${mark} data-fact="${row.fact_id}">${row.raw}</data>`
}
const prose = (inner: string, lead = "The figure is") => `<p>${lead} ${inner} [S4].</p>`
const cell = (inner: string) => `<table><tr><th>Item</th><td>${inner}</td></tr></table>`

describe("every claim kind against the hand-written oracle", () => {
	for (const kind of Object.keys(ORACLE)) {
		for (const row of SUBJECTS) {
			const want = expected(kind, row)
			const label = want.length === 0 ? "no claim defect" : `${want[0]} major`
			test(`#given ${kind} marked on ${row.fact_id} (${row.kind}) in prose and in a table cell #then ${label}`, () => {
				for (const body of [prose(value(row, kind)), cell(value(row, kind))]) {
					expect(codes(body)).toEqual(want)
					for (const defect of claims(body)) expect(defect.severity).toBe("major")
				}
			})
			test(`#given ${kind} marked on an enclosing element over ${row.fact_id} #then the parent's mark binds it: ${label}`, () => {
				expect(codes(`<p><span ${CLAIM_ATTRIBUTE}="${kind}">The figure is ${value(row)}</span> [S4].</p>`)).toEqual(want)
			})
			test(`#given ${kind} marked on ${row.fact_id} beside an unmarked command row #then the neighbour never satisfies it: ${label}`, () => {
				expect(codes(prose(`${value(row, kind)}, and the suite reported ${value(F7)}`))).toEqual(want)
			})
			for (const inner of Object.keys(ORACLE).filter((other) => other !== kind)) {
				test(`#given ${inner} nested inside ${kind} over ${row.fact_id} #then mismatch, the parent owns nothing, and the inner kind is still checked`, () => {
					const body = `<p><span ${CLAIM_ATTRIBUTE}="${kind}">The figure is ${value(row, inner)}</span> [S4].</p>`
					expect(codes(body)).toEqual(["claim_kind_mismatch", MAJOR_FOR[kind] as string, ...expected(inner, row)].sort())
				})
			}
		}
	}

	for (const row of SUBJECTS) {
		const refused = UNMARKED_REFUSED.has(row.fact_id) ? ["claim_kind_mismatch:major"] : []
		const refusedLabel = refused.length ? "claim_kind_mismatch major" : "no claim code"
		test(`#given ${row.fact_id} unmarked in a first-person run sentence #then the minor verification_claim_unmarked, plus ${refusedLabel}`, () => {
			const found = claims(prose(value(row), "We ran the check and it reported"))
			expect(found.map((d) => `${d.code}:${d.severity}`).sort()).toEqual([...refused, "verification_claim_unmarked:minor"].sort())
		})
		test(`#given ${row.fact_id} unmarked in a plain sentence in prose and in a table cell #then ${refusedLabel}`, () => {
			for (const body of [prose(value(row)), cell(value(row))]) expect(claims(body).map((d) => `${d.code}:${d.severity}`)).toEqual(refused)
		})
	}

	test("#given an unknown claim kind #then claim_kind_mismatch", () => {
		expect(codes(prose(value(F1, "rumoured")))).toEqual(["claim_kind_mismatch"])
	})

	test("#given every defect and warning code the table names #then contracts defines it, and warnings are never major", () => {
		for (const entry of Object.values(CLAIM_KINDS) as { defect: string; unmarked: { code: string } | null }[]) {
			expect(DEFECT_CODES[entry.defect]).toBeDefined()
			if (entry.unmarked) expect(DEFECT_CODES[entry.unmarked.code].severity).toBe("minor")
		}
	})
})

describe("design-check regressions", () => {
	test("#given verified wrapping a fact-marked page row (F1 shadowing) #then the parent is unsupported and the nesting is a mismatch", () => {
		expect(codes(`<p><span ${CLAIM_ATTRIBUTE}="verified">The inspection put the span at ${value(F1, "fact")}</span> [S4].</p>`)).toEqual(["claim_kind_mismatch", "unsupported_verification"])
	})

	test("#given one verified value and an unmarked value in the same run sentence (F2) #then the unmarked one still warns", () => {
		expect(codes(prose(`${value(F7, "verified")}, and the span is ${value(F1)}`, "We ran the suite and it reported"))).toEqual(["verification_claim_unmarked"])
	})

	test("#given a truthful converted and derived value marked fact (F3) #then no stricter than unmarked", () => {
		for (const row of [F8, F9, F10]) expect(codes(prose(value(row, "fact")))).toEqual(codes(prose(value(row))))
		expect(codes(prose(value(F8, "fact")))).toEqual([])
	})

	test("#given the assumed row F9 unmarked or marked fact #then both refuse it, and the unmarked message names the A mark", () => {
		expect(codes(prose(value(F9)))).toEqual(["claim_kind_mismatch"])
		expect(codes(prose(value(F9, "fact")))).toEqual(["claim_kind_mismatch"])
		expect(JSON.stringify(claims(prose(value(F9))))).toContain("{{A:F9}}")
	})

	test("#given the assumed row F9 marked {{A:F9}} (data-claim-kind=assumed) #then no claim defect", () => {
		expect(codes(prose(value(F9, "assumed")))).toEqual([])
		expect(codes(cell(value(F9, "assumed")))).toEqual([])
	})

	test("#given verified citing a command-sourced row with no, a missing, or an escaping locator artifact (F4) #then unsupported_verification", () => {
		for (const row of [F11, F12, F13]) expect(codes(prose(value(row, "verified")))).toEqual(["unsupported_verification"])
	})
})

describe("unmarked phrases", () => {
	const fires = [
		"We verified the span by running the measurement script.",
		"We ran the suite twice.",
		"We executed the export.",
		"We verified by hand-counting the rows.",
		"We have run the tests.",
		"I ran the suite.",
		"Our numbers were obtained by running the script.",
		"우리가 실행해 확인한 길이",
		"저희가 스크립트를 실행하여 검증한 값",
		"저희가 테스트를 돌렸다",
		"우리 팀이 벤치마크를 돌려 얻은 값",
		"그래서 우리는 스크립트를 실행했다",
		"직접 실행한 결과",
	]
	const quiet = [
		"The tests showed a 12 % drop.",
		"The bridge, which ran across the river, spans 320 m.",
		"The span, as confirmed with the annual inspection report, is 320 m.",
		"Clinical tests confirmed the diagnosis.",
		"The authors obtained estimates by running simulations.",
		"We ran out of time.",
		"확인된 길이는 최대 320 m",
		"개발자가 직접 실행한 결과를 보고했다",
		"실행해 확인한 길이",
		"우리나라에서 실행된 정책은 320개다",
		"우리 정부가 실행한 예산",
		"우리가 의뢰한 업체가 테스트를 돌렸다",
		"우리는 결과를 확인했다",
	]
	for (const text of fires) test(`#given "${text}" #then verified`, () => expect(unmarkedKinds(text)).toEqual(["verified"]))
	for (const text of quiet) test(`#given "${text}" #then nothing`, () => expect(unmarkedKinds(text)).toEqual([]))
})

describe("references/fidelity-claim-kinds.md is rendered from CLAIM_KINDS", () => {
	const doc = readFileSync(join(import.meta.dir, "..", "references", "fidelity-claim-kinds.md"), "utf8")

	test("the committed table section equals renderClaimKindTable() byte for byte", () => {
		const [begin, end] = [doc.indexOf(CLAIM_TABLE_BEGIN), doc.indexOf(CLAIM_TABLE_END)]
		expect(begin).toBeGreaterThanOrEqual(0)
		expect(end).toBeGreaterThan(begin)
		expect(doc.slice(begin + CLAIM_TABLE_BEGIN.length + 1, end)).toBe(renderClaimKindTable())
	})

	test("node claim-kinds.mjs --render-doc prints the same table", () => {
		const result = spawnSync("node", [join(import.meta.dir, "claim-kinds.mjs"), "--render-doc"], { encoding: "utf8" })
		expect(result.status).toBe(0)
		expect(result.stdout).toBe(renderClaimKindTable())
	})
})
