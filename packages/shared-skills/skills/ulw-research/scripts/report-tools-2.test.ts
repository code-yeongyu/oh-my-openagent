import { describe, expect, onTestFinished, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { PROMOTION } from "./fact-commands-meaning.mjs"
import { writeFidelityRecord } from "./fidelity-records.mjs"
import { PAIR_KINDS } from "./fact-pairs.mjs"
import { VERDICT_SCHEMA } from "./meaning-check.mjs"
import { POLISH_MARKUP_REASON } from "./polish-apply.mjs"
import { COMMANDS, run } from "./report-tools.mjs"
import { SCRIPT, FIXTURES, sessionDir, nodeWithoutBun, defectsFile, FIDELITY, sha256, CliRow, CliJson, nodeJson, fidelitySession, verify, codesOf, Pair, pairedSession, verdicts, calibrationRows, runLines, PolishJson, polishSession, polishApply, setField, fillTemplate, textSource, ledgerRow } from "./tests/report-tools-support"



describe("fact, source, and claims under node", () => {
	test("#given a fresh session #when snapshot, add, quote, derive, fill, and verify run #then the filled report verifies clean", () => {
		// given
		const { dir, s, snap, add, quote, derive, mm } = fidelitySession()
		// when
		const filled = nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const checked = verify(dir, "report.html")
		// then
		expect(snap.code).toBe(0)
		expect(add.code).toBe(0)
		expect(add.json.data.row.value).toBe("320")
		expect(add.json.data.context.match).toBe("320 m")
		expect(quote.code).toBe(0)
		expect(quote.json.data.row.fact_id).toBe("Q1")
		expect(derive.code).toBe(0)
		expect(mm).toBe("F2")
		expect(filled.code).toBe(0)
		expect(readFileSync(join(dir, "report.html"), "utf8")).toContain("320,000 mm (320 m)")
		expect(checked.code).toBe(0)
		expect(checked.json.defects).toEqual([])
		const record = JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8"))
		expect(record.artifact_sha256).toBe(sha256(join(dir, "report.html")))
	})

	test("#given a filled report #when a value is hand-edited or a number typed #then verify exits 1 with the code", () => {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const html = readFileSync(join(dir, "report.html"), "utf8")
		writeFileSync(join(dir, "unit.html"), html.replace("320 m", "320 mm"))
		writeFileSync(join(dir, "typed.html"), html.replace("<h2>How", "<p>Revenue grew 12% [S4].</p>\n<h2>How"))
		const unit = verify(dir, "unit.html")
		const typed = verify(dir, "typed.html")
		expect(unit.code).toBe(1)
		expect(codesOf(unit.json)).toContain("unit_mismatch")
		expect(typed.code).toBe(1)
		expect(codesOf(typed.json)).toContain("untraceable_number")
	})

	test("#given an anchor that is not in the source #when fact add runs #then it exits 1 with fact_not_located and writes no row", () => {
		const { dir, s } = fidelitySession()
		const proc = nodeJson(["fact", "add", "--source", "S4", "--find", "nope", "--label", "x", ...s])
		expect(proc.code).toBe(1)
		expect(proc.stdout).toContain("fact_not_located")
		expect(JSON.parse(readFileSync(join(dir, "fact-ledger.json"), "utf8")).rows.map((r: { fact_id: string }) => r.fact_id)).toEqual(["F1", "Q1", "F2"])
	})

	test("#given a snapshotted source #when snapshotted again with the same or different content #then same is a no-op and different exits 1", () => {
		const { dir, s } = fidelitySession()
		writeFileSync(join(dir, "other.txt"), "Span length: 999 m\n")
		expect(nodeJson(["source", "snapshot", "--id", "S4", "--html", join(FIDELITY, "sources", "S4.html"), ...s]).code).toBe(0)
		expect(nodeJson(["source", "snapshot", "--id", "S4", "--text", join(dir, "other.txt"), ...s]).code).toBe(1)
	})

	test("#given an assumed value with and without a rationale #when added #then the row is kind assumed, and no rationale exits 2", () => {
		const { s } = fidelitySession()
		const added = nodeJson(["fact", "add", "--assumed", "12", "--unit", "%", "--rationale", "planning share chosen by the requester", "--label", "share_assumed", "--json", ...s])
		expect(added.code).toBe(0)
		expect(added.json.data.row.kind).toBe("assumed")
		expect(nodeJson(["fact", "add", "--assumed", "12", "--label", "x", ...s]).code).toBe(2)
	})

	test("#given the fixture claim graph #when claims index runs #then claims.json lists its claims", () => {
		const dir = sessionDir()
		const proc = nodeJson(["claims", "index", join(FIDELITY, "claim-graph.md"), "--out", join(dir, "claims.json")])
		expect(proc.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "claims.json"), "utf8")).claims.length).toBeGreaterThan(0)
	})

	test("#given a ledger #when exported as csv #then rows carry fact_id and plot_value and stderr has the coverage line", () => {
		const { s } = fidelitySession()
		const proc = nodeJson(["fact", "export", "--csv", ...s])
		expect(proc.code).toBe(0)
		expect(proc.stdout.split("\n")[0]).toContain("fact_id")
		expect(proc.stdout).toContain("F2")
		expect(proc.stderr).toContain("1 of 1 sources snapshotted")
	})
})

describe("meaning verifier under node", () => {
	test("#given the filled fixture #when fact pairs runs #then pairs.json holds one quote pair per cited ledger quote", () => {
		const { dir, pairs } = pairedSession()
		const written = JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8"))
		expect(pairs.code).toBe(0)
		expect(written.skipped).toBe(false)
		expect(written.pairs.map((p: Pair) => [p.pair_id, p.kind, p.fact_ids])).toEqual([
			["P1", "quote", ["F1"]],
			["P2", "quote", ["Q1"]],
		])
		expect(written.pairs_sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(Object.keys(written.counts).filter((key) => key !== "total" && key !== "force_strong")).toEqual([...PAIR_KINDS])
		expect(written.verdict_schema).toEqual(JSON.parse(JSON.stringify(VERDICT_SCHEMA)))
	})

	test("#given cheap and strong verdicts agreeing on hedge_dropped #when meaning-check runs #then it exits 1 with one confirmed defect and one calibration line", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate", explanation: "The estimate reads as a fact." }
		const cheap = verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }])
		const strong = verdicts(dir, "strong.json", "strong", [drift])
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, "--verdicts", strong, ...s])
		const record = JSON.parse(readFileSync(join(dir, "fidelity-meaning-defects.json"), "utf8"))
		expect(checked.code).toBe(1)
		expect(codesOf(checked.json)).toEqual(["meaning_drift_confirmed"])
		expect(codesOf(record)).toEqual(["meaning_drift_confirmed"])
		expect(calibrationRows(dir)).toHaveLength(1)
		expect(calibrationRows(dir)[0]).toMatchObject({ pair_id: "P2", drift_kind: "hedge_dropped", confirmed: true, disputed: false })
		const header = JSON.parse(readFileSync(join(dir, "fidelity-calibration.jsonl"), "utf8").split("\n")[0])
		expect(header.promotion).toEqual({ ...PROMOTION })
		const again = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, "--verdicts", strong, ...s])
		expect(again.code).toBe(1)
		expect(calibrationRows(dir)).toHaveLength(1)
	})

	test("#given a dispute on the confirmed pair #when meaning-check runs #then the defect stays and the calibration line is disputed", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate" }
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }]), "--verdicts", verdicts(dir, "strong.json", "strong", [drift])]
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, "--dispute", "P2", "--reason", "the operator states it", ...s])
		expect(checked.code).toBe(1)
		expect(codesOf(checked.json)).toEqual(["meaning_drift_confirmed"])
		expect(calibrationRows(dir)[0]).toMatchObject({ pair_id: "P2", disputed: true, reason: "the operator states it" })
	})

	test("#given --edition md #when meaning-check runs #then it writes that edition's record, and an unknown edition refuses", () => {
		const { dir, s } = pairedSession()
		const clean = [{ pair_id: "P1", verdict: "ok" }, { pair_id: "P2", verdict: "ok" }]
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", clean), "--verdicts", verdicts(dir, "strong.json", "strong", clean)]
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, "--edition", "md", ...s])
		const unknown = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, "--edition", "epub", ...s])
		expect(checked.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "fidelity-meaning-defects.md.json"), "utf8"))).toMatchObject({ record_kind: "meaning", artifact_sha256: sha256(join(dir, "report.html")) })
		expect(existsSync(join(dir, "fidelity-meaning-defects.json"))).toBe(false)
		expect(unknown.code).toBe(2)
	})

	test("#given a dropped verdict and an unread pair #when meaning-check runs #then both pairs are meaning_unverified and it exits 1", () => {
		const { dir, s } = pairedSession()
		const cheap = verdicts(dir, "cheap.json", "cheap", [{ pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "certainly by 2027", source_fragment: "we estimate" }])
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, ...s])
		const summary = JSON.parse(checked.stderr.trim().split("\n").at(-1) ?? "{}")
		expect(checked.code).toBe(1)
		expect(checked.json.status).toBe("fail")
		expect(codesOf(checked.json)).toEqual(["meaning_unverified", "meaning_unverified"])
		expect(checked.json.unverified.map((gap: { pair_id: string }) => gap.pair_id)).toEqual(["P1", "P2"])
		expect(summary).toMatchObject({ command: "fact meaning-check", defects: 2, dropped: 1, unverified: 2 })
	})

	test("#given an unreadable verdict file or a malformed pairs file #when meaning-check runs #then it exits 2", () => {
		const { dir, s } = pairedSession()
		const broken = join(dir, "broken.json")
		writeFileSync(broken, "{ not json")
		expect(nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", broken, ...s]).code).toBe(2)
		const ok = verdicts(dir, "cheap.json", "cheap", [])
		for (const body of ["{}", "null", '{ "pairs": "P1" }']) {
			writeFileSync(join(dir, "bad-pairs.json"), body)
			expect(nodeJson(["fact", "meaning-check", "--pairs", join(dir, "bad-pairs.json"), "--verdicts", ok, ...s]).code, body).toBe(2)
		}
	})

	test("#given a confirmed run then a dispute on the same inputs #when meaning-check reruns #then the log still holds one run with the dispute", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate" }
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }]), "--verdicts", verdicts(dir, "strong.json", "strong", [drift])]
		const first = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, ...s])
		const disputed = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, "--dispute", "P2", "--reason", "the operator states it", ...s])
		expect(disputed.code).toBe(1)
		expect(disputed.json.run_id).toBe(first.json.run_id)
		expect(disputed.json.promotion_eligibility).toMatchObject({ runs: 1, confirmed: 1, disputed_confirmed: 1, disputed_to_confirmed: 1 })
		expect(calibrationRows(dir)).toEqual([expect.objectContaining({ pair_id: "P2", disputed: true, reason: "the operator states it" })])
		const plain = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, ...s])
		expect(plain.json.promotion_eligibility).toMatchObject({ runs: 1, disputed_confirmed: 1 })
	})

	test("#given a run with no flagged pair #when meaning-check runs #then the run is still logged and counted", () => {
		const { dir, s } = pairedSession()
		const ok = (pair_id: string) => ({ pair_id, verdict: "ok" })
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", [ok("P1"), ok("P2")]), "--verdicts", verdicts(dir, "strong.json", "strong", [ok("P1"), ok("P2")])]
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, ...s])
		expect(checked.code).toBe(0)
		expect(calibrationRows(dir)).toEqual([])
		expect(runLines(dir)).toEqual([expect.objectContaining({ run_id: checked.json.run_id, flagged: 0 })])
		expect(checked.json.promotion_eligibility.runs).toBe(1)
	})

	test("#given a corrupt calibration log #when meaning-check runs #then it exits 2 naming the file and line", () => {
		const { dir, s } = pairedSession()
		writeFileSync(join(dir, "fidelity-calibration.jsonl"), "{ not json\n")
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", verdicts(dir, "cheap.json", "cheap", []), ...s])
		expect(checked.code).toBe(2)
		expect(checked.stderr).toContain(`${join(dir, "fidelity-calibration.jsonl")}:1`)
	})

	test("#given a skipped pairs file #when meaning-check runs #then it is accepted only when the locked brief says off", () => {
		const { dir, s } = fidelitySession()
		const skip = join(dir, "skip.json")
		writeFileSync(skip, JSON.stringify({ schemaVersion: 1, skipped: true, pairs: [] }))
		const check = () => nodeJson(["fact", "meaning-check", "--pairs", skip, "--verdicts", verdicts(dir, "cheap.json", "cheap", []), ...s])
		const on = check()
		expect(on.code).toBe(1)
		expect(on.json.error).toBe("meaning_check_required")
		writeFileSync(join(dir, "brief.md"), "# Brief\n")
		expect(check().json.error).toBe("fidelity_interview_incomplete")
		expect(check().code).toBe(1)
		writeFileSync(join(dir, "brief.md"), readFileSync(join(FIXTURES, "fidelity-brief-locked.md"), "utf8").replace("meaning check: on", "meaning check: off"))
		const off = check()
		expect(off.code).toBe(0)
		expect(off.json.status).toBe("skipped")
	})

	test("#given a brief with meaning check off #when fact pairs runs #then it exits 0 and writes skipped", () => {
		const { dir, s } = fidelitySession()
		const brief = readFileSync(join(dir, "brief.md"), "utf8").replace("meaning check: on", "meaning check: off")
		writeFileSync(join(dir, "brief.md"), brief)
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const pairs = nodeJson(["fact", "pairs", join(dir, "report.html"), "--out", join(dir, "pairs.json"), ...s])
		expect(pairs.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8"))).toMatchObject({ skipped: true })
	})
})
