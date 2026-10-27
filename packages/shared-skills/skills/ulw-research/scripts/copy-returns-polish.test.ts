// Architecture contract for the polish command (#11160 sweep): the edit contract, the ledger
// loader, the edition-format grammar, and the severity buckets each have one owner export, so a
// reintroduced local copy in fact-commands-polish.mjs fails one of these tests.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CliError } from "./cli-support.mjs"
import { countDefects, DEFECT_CODES, SEVERITIES } from "./contracts.mjs"
import { runFactMeaning } from "./fact-commands-meaning.mjs"
import * as polishCommand from "./fact-commands-polish.mjs"
import { editionFormatOf, ledgerFrom, sessionOf } from "./fact-commands-verify.mjs"
import { applyEdits, POLISH_EDIT_FIELDS, POLISH_MARKUP_REASON, validatePolishEdits } from "./polish-apply.mjs"

const { polishDiffFails, runFactPolish } = polishCommand
const source = (name: string) => readFileSync(join(import.meta.dir, name), "utf8")
const LEDGER = { schemaVersion: 1, rows: [], events: [] }
const doc = (body: string) => `<html><body>\n${body}\n</body></html>`
const BRIEF = join(import.meta.dir, "tests", "fixtures", "fidelity-brief-locked.md")

const dir = mkdtempSync(join(tmpdir(), "polish-copy-returns-"))
const file = (name: string, content: string) => {
	const path = join(dir, name)
	writeFileSync(path, content)
	return path
}
const ledgerPath = file("ledger.json", JSON.stringify(LEDGER))
const badLedgerPath = file("bad-ledger.json", JSON.stringify({ schemaVersion: 1, rows: "nope" }))
const reportPath = file("report.html", doc("<p>The span is 320 m [S1].</p>"))
const savedSession = process.env.SESSION_DIR
beforeEach(() => {
	delete process.env.SESSION_DIR
})
afterEach(() => {
	if (savedSession === undefined) delete process.env.SESSION_DIR
	else process.env.SESSION_DIR = savedSession
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function outcome(run: () => unknown) {
	try {
		run()
		return "ok"
	} catch (error) {
		if (!(error instanceof CliError)) throw error
		return error.message
	}
}

describe("the polish edit contract is polish-apply's", () => {
	const SHAPES = [
		["not an array", { before: "a", after: "b" }],
		["a null edit", [null]],
		["an array edit", [["a", "b"]]],
		["a missing after", [{ before: "span" }]],
		["a numeric before", [{ before: 3, after: "b" }]],
		["a numeric reason", [{ before: "span", after: "span", reason: 5 }]],
		["a valid edit", [{ before: "The span is", after: "The span is", reason: "none" }]],
		["a valid edit without reason", [{ before: "The span is", after: "The span is" }]],
	] as const

	test("#given the command module #when its edit contract is read #then it is the polish-apply export", () => {
		expect(polishCommand.validatePolishEdits).toBe(validatePolishEdits)
		expect(polishCommand.POLISH_EDIT_FIELDS).toBe(POLISH_EDIT_FIELDS)
		expect(source("fact-commands-polish.mjs")).not.toMatch(/typeof edit\?\.(before|after)/u)
	})

	for (const [name, edits] of SHAPES) {
		test(`#given ${name} #when applied directly and through the CLI #then both accept or both refuse`, () => {
			const editsPath = file(`edits-${name.replaceAll(" ", "-")}.json`, JSON.stringify(edits))
			const direct = (() => {
				try {
					applyEdits(readFileSync(reportPath, "utf8"), edits as never, LEDGER)
					return "ok"
				} catch (error) {
					expect(error).toBeInstanceOf(TypeError)
					return "refused"
				}
			})()
			const cli = outcome(() => runFactPolish("polish-apply", [reportPath, "--edits", editsPath, "--ledger", ledgerPath, "--brief", BRIEF, "--out", join(dir, "out.html")]))
			expect(cli === "ok" ? "ok" : "refused").toBe(direct)
			if (cli !== "ok") expect(cli).toContain(editsPath)
		})
	}
})

describe("the ledger loader is one shared helper", () => {
	const pairs = (extra: string[]) => () => runFactMeaning("pairs", [reportPath, "--brief", BRIEF, "--out", join(dir, "pairs.json"), ...extra])
	const diff = (extra: string[]) => () => runFactPolish("polish-diff", ["--before", reportPath, "--after", reportPath, "--brief", BRIEF, ...extra])

	test("#given the command modules #when read #then neither defines its own ledger loader or session resolver", () => {
		expect(polishCommand.ledgerFrom).toBe(ledgerFrom)
		for (const name of ["fact-commands-meaning.mjs", "fact-commands-polish.mjs"]) {
			const text = source(name)
			expect(text, name).not.toMatch(/function (readLedgerFrom|ledgerFrom)\b|validateLedger\(/u)
			expect(text, name).not.toMatch(/const sessionOf\s*=/u)
		}
	})

	test("#given the same valid, invalid, and missing ledgers #when fact pairs and fact polish-diff load them #then both give the same outcome", () => {
		for (const extra of [["--ledger", ledgerPath], ["--ledger", badLedgerPath], []]) {
			const expected = outcome(() => ledgerFrom({ ...(extra.length > 0 ? { ledger: extra[1] } : {}) }))
			expect(outcome(pairs(extra)), extra.join(" ")).toBe(expected)
			expect(outcome(diff(extra)), extra.join(" ")).toBe(expected)
		}
		expect(outcome(() => ledgerFrom({ ledger: badLedgerPath }))).toContain("is not a valid fact ledger")
		expect(outcome(() => ledgerFrom({}))).toContain("--ledger is required")
	})

	test("#given a session dir flag or SESSION_DIR #when resolved #then the flag wins and a bare flag is no session", () => {
		expect(sessionOf({ "session-dir": dir })).toBe(dir)
		expect(sessionOf({ "session-dir": true })).toBeNull()
		process.env.SESSION_DIR = dir
		expect(sessionOf({})).toBe(dir)
	})
})

describe("the edition format comes from verify's grammar", () => {
	test("#given report paths of each case #when polish-apply reads them #then it refuses exactly the Markdown classifications", () => {
		const editsPath = file("edits-ok.json", "[]")
		expect(source("fact-commands-polish.mjs")).not.toMatch(/md\|markdown/u)
		for (const name of ["r.md", "R.MD", "r.markdown", "R.Markdown", "r.html", "r.HTML"]) {
			const path = file(name, readFileSync(reportPath, "utf8"))
			const result = outcome(() => runFactPolish("polish-apply", [path, "--edits", editsPath, "--ledger", ledgerPath, "--brief", BRIEF, "--out", join(dir, "out.html")]))
			expect(result.includes("takes the filled HTML edition"), name).toBe(editionFormatOf(path, undefined) === "md")
		}
	})
})

describe("polish-diff counts with contracts and exits on blockers only", () => {
	type DiffRun = { exitCode: number; json: { counts: Record<string, number>; defects: { severity: string }[] } }
	const run = (before: string, after: string) => runFactPolish("polish-diff", ["--before", file("b.html", doc(before)), "--after", file("a.html", doc(after)), "--ledger", ledgerPath, "--brief", BRIEF]) as unknown as DiffRun

	test("#given every registry code #when polishDiffFails classifies it #then only registry blockers fail", () => {
		for (const [code, entry] of Object.entries(DEFECT_CODES) as [string, { severity: string }][]) expect(polishDiffFails([{ code, severity: "minor" }]), code).toBe(entry.severity === "blocker")
		expect(polishDiffFails([])).toBe(false)
		expect(source("fact-commands-polish.mjs")).not.toMatch(/blocker:\s*0|counts\.blocker > 0/u)
	})

	test("#given a major-only polish diff #when run #then it is reported with contract buckets and exits 0", () => {
		const result = run("<p>The span may be 320 m [S1].</p>", "<p>The span is 320 m [S1].</p>")
		const { defects } = result.json
		expect(defects.length).toBeGreaterThan(0)
		expect(defects.every((defect) => defect.severity === "major")).toBe(true)
		expect(result.json.counts).toEqual(countDefects(defects))
		expect(Object.keys(result.json.counts)).toEqual([...SEVERITIES, "total"])
		expect(result.exitCode).toBe(0)
	})

	test("#given a changed numeral #when run #then the blocker exits 1", () => {
		const result = run("<p>Throughput grew 3.5 times [S1].</p>", "<p>Throughput grew 35 times [S1].</p>")
		expect(result.json.counts).toEqual(countDefects(result.json.defects))
		expect(result.exitCode).toBe(1)
	})
})

describe("fact polish-apply prints every rejection reason verbatim", () => {
	type ApplyRun = { summary: string; exitCode: number; json: { defects: { index: number; code: string; reason: string }[]; data: { rejected: number; rejected_reasons: string[] } } }

	test("#given an edit holding & #when fact polish-apply runs #then the printed line carries polish-apply's own markup reason", () => {
		const before = "Revenue & profit rose across the year"
		const editsPath = file("edits-markup-ampersand.json", JSON.stringify([{ before, after: "Revenue and profit rose across the year", reason: "wording" }]))
		const run = runFactPolish("polish-apply", [reportPath, "--edits", editsPath, "--ledger", ledgerPath, "--brief", BRIEF, "--out", join(dir, "ampersand.html")]) as unknown as ApplyRun

		expect(run.exitCode).toBe(0)
		expect(run.json.data.rejected).toBe(1)
		expect(run.json.defects.map((defect) => [defect.index, defect.code, defect.reason])).toEqual([[0, "polish_edit_rejected", POLISH_MARKUP_REASON]])
		const line = `  rejected edit 0 ("${before}"): ${POLISH_MARKUP_REASON}`
		expect(run.json.data.rejected_reasons).toEqual([line])
		expect(run.summary.split("\n")[1]).toBe(line)
	})
})

describe("--changed-since stays fail-closed", () => {
	const { pairsChangedSince } = polishCommand as unknown as { pairsChangedSince: (pairs: unknown[], mapPath: string, ledger: unknown, claims: unknown) => unknown[] }
	const artifact = file("pre-polish.html", doc("<p>The span is 320 m [S1].</p>"))

	test("#given a fill map without artifact_sha256 #when --changed-since reads it #then it refuses", () => {
		const mapPath = file("fill-map-no-sha.json", JSON.stringify({ artifact, format: "html", entries: [] }))
		expect(outcome(() => pairsChangedSince([], mapPath, LEDGER, null))).toContain("fill map has no artifact_sha256")
	})

	test("#given a fill map whose artifact changed since fill #when read #then it still refuses", () => {
		const mapPath = file("fill-map-stale.json", JSON.stringify({ artifact, artifact_sha256: "0".repeat(64), format: "html", entries: [] }))
		expect(outcome(() => pairsChangedSince([], mapPath, LEDGER, null))).toContain("changed after fill")
	})
})

describe("polish-diff refuses an unknown defect code", () => {
	test("#given a defect whose code is not in the registry #when classified #then it refuses instead of reading its severity", () => {
		expect(outcome(() => polishDiffFails([{ code: "not_a_real_code", severity: "minor" }]))).toContain("unknown defect code not_a_real_code")
		expect(source("fact-commands-polish.mjs")).not.toMatch(/\?\?\s*defect\.severity/u)
	})
})

describe("polish-apply writes atomically and honours --format", () => {
	test("#given the command module #when read #then it writes the edition through writeTextAtomic", () => {
		const text = source("fact-commands-polish.mjs")
		expect(text).not.toMatch(/writeFileSync\s*\(/u)
		expect(text).toMatch(/writeTextAtomic\(flags\.out/u)
	})

	test("#given --format md on an .html report #when polish-apply runs #then it refuses the Markdown edition", () => {
		const editsPath = file("edits-format.json", "[]")
		const result = outcome(() => runFactPolish("polish-apply", [reportPath, "--edits", editsPath, "--ledger", ledgerPath, "--brief", BRIEF, "--out", join(dir, "fmt.html"), "--format", "md"]))
		expect(result).toContain("takes the filled HTML edition")
	})
})
