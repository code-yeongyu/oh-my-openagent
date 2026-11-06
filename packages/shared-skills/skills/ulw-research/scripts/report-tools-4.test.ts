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



describe("fidelity delivery barrier", () => {
	/**
	 * The locked brief has meaning check on, so a deliverable session also carries a clean meaning record:
	 * one edition's (fidelity-meaning-defects.<format>.json), or without a format the legacy session record.
	 */
	const meaningRan = (dir: string, report = "report.html", format?: string) =>
		writeFidelityRecord(join(dir, format === undefined ? "fidelity-meaning-defects.json" : `fidelity-meaning-defects.${format}.json`), "meaning", { artifact_sha256: sha256(join(dir, report)), report: join(dir, report), defects: [] })

	async function deliveredSession(codes: string[]) {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		meaningRan(dir)
		const record = (list: string[]) => writeFidelityRecord(join(dir, "fidelity-defects.json"), "fidelity", { artifact_sha256: sha256(join(dir, "report.html")), report: join(dir, "report.html"), defects: list.map((code) => ({ code, message: code })) })
		record(codes)
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const decide = ["repair", "decide", "--state", join(dir, "repair-state.json"), "--defects", join(dir, "fidelity-defects.json"), "--artifact-bytes", "4096", "--renders", "1", "--session-dir", dir]
		await run(decide)
		const decision = await run(decide)
		return { dir, record, decision }
	}

	test("#given a clean meaning record #when the report is edited and fact verify re-run #then the stale meaning record refuses, and a fresh one passes", async () => {
		// given: meaning check on, readers clean, the edition verified and delivered
		const { dir, s } = pairedSession()
		const report = join(dir, "report.html")
		const clean = [{ pair_id: "P1", verdict: "ok" }, { pair_id: "P2", verdict: "ok" }]
		const readers = () => nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", verdicts(dir, "cheap.json", "cheap", clean), "--verdicts", verdicts(dir, "strong.json", "strong", clean), ...s])
		expect(readers().code).toBe(0)
		expect(verify(dir, "report.html").code).toBe(0)
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", report, "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const first = await run(["outcome", "verify", "--session-dir", dir])
		// when: draft 2 (a repair rewrite) is re-verified by fact verify only
		writeFileSync(report, `${readFileSync(report, "utf8")}\n<!-- draft 2 -->\n`)
		expect(verify(dir, "report.html").code).toBe(0)
		const stale = await run(["outcome", "verify", "--session-dir", dir])
		// when: the meaning readers run again on draft 2
		expect(nodeJson(["fact", "pairs", report, "--out", join(dir, "pairs.json"), ...s]).code).toBe(0)
		expect(readers().code).toBe(0)
		const fresh = await run(["outcome", "verify", "--session-dir", dir])
		// then
		expect(first.exitCode).toBe(0)
		expect(stale.exitCode).toBe(1)
		expect(stale.json.problems).toContainEqual(expect.objectContaining({ code: "edition_unverified", path: join(dir, "fidelity-meaning-defects.json"), message: expect.stringContaining("meaning record") }))
		expect(fresh.exitCode).toBe(0)
	})

	test("#given an unregistered appendix value #when verified #then untraceable_number and outcome verify refuses", async () => {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const html = readFileSync(join(dir, "report.html"), "utf8").replace("<h2>How", "<h2>Appendix</h2>\n<p>Revenue grew 12% [S4].</p>\n<h2>How")
		writeFileSync(join(dir, "report.html"), html)
		const checked = verify(dir, "report.html")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const outcome = await run(["outcome", "verify", "--session-dir", dir])
		expect(codesOf(checked.json)).toContain("untraceable_number")
		expect(outcome.exitCode).toBe(1)
		expect(outcome.json.problems.map((p: { code: string }) => p.code)).toContain("fidelity_unresolved")
	})

	for (const code of ["untraceable_number", "unbound_sentence"]) {
		test(`#given ${code} left after repair delivers on exhaustion #when verified and finished #then both refuse, and an empty record passes`, async () => {
			const { dir, record, decision } = await deliveredSession([code])
			const refused = await run(["outcome", "verify", "--session-dir", dir])
			const finish = await run(["outcome", "finish", "--session-dir", dir])
			record([])
			const passed = await run(["outcome", "verify", "--session-dir", dir])
			const finished = await run(["outcome", "finish", "--session-dir", dir])
			expect(decision.json.decision.action).toBe("deliver")
			expect(refused.exitCode).toBe(1)
			expect(JSON.stringify(refused.json.problems)).toContain(`fidelity_unresolved: ${code}`)
			expect(finish.exitCode).toBe(1)
			expect(passed.exitCode).toBe(0)
			expect(finished.exitCode).toBe(0)
		})
	}

	test("#given a clean main report and an inline edition #when the edition lacks or mismatches its verify record #then edition_unverified, and its own record passes", async () => {
		// given
		const { dir, s } = fidelitySession()
		// a stylesheet and an image, so the inline edition's bytes differ from report.html
		writeFileSync(join(dir, "report.css"), "body { margin: 0 auto; max-width: 42rem; }")
		writeFileSync(join(dir, "report.src.html"), readFileSync(join(dir, "report.src.html"), "utf8").replace("</title>", '</title><link rel="stylesheet" href="report.css">').replace("<h2>Findings</h2>", '<h2>Findings</h2>\n<img src="assets/bridge.png" alt="The bridge from the south bank">'))
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		expect(verify(dir, "report.html").code).toBe(0)
		meaningRan(dir)
		expect(nodeJson(["fact", "fill", join(dir, "report.src.html"), "--inline", "--out", join(dir, "report.inline.html"), ...s]).code).toBe(0)
		const inline = readFileSync(join(dir, "report.inline.html"), "utf8")
		expect(inline).toContain("<style>body { margin: 0 auto; max-width: 42rem; }</style>")
		expect(inline).toContain(`src="${join(dir, "assets", "bridge.png")}"`)
		expect(sha256(join(dir, "report.inline.html"))).not.toBe(sha256(join(dir, "report.html")))
		// html keeps the legacy session meaning record; the byte-different inline edition needs its own
		meaningRan(dir, "report.inline.html", "pdf")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html,pdf"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const problems = async () => {
			const result = await run(["outcome", "verify", "--session-dir", dir])
			return { exitCode: result.exitCode, codes: result.json.problems.map((p: { code: string }) => p.code) }
		}
		// when: no --verified-by
		await run(["outcome", "set", "pdf", "delivered", "--path", join(dir, "report.inline.html"), "--session-dir", dir])
		const missing = await problems()
		// when: a record for different bytes
		expect(verify(dir, "report.inline.html", ["--out", join(dir, "fidelity-inline.json")]).code).toBe(0)
		writeFileSync(join(dir, "report.inline.html"), inline.replace("320,000 mm", "330,000 mm"))
		await run(["outcome", "set", "pdf", "delivered", "--path", join(dir, "report.inline.html"), "--verified-by", join(dir, "fidelity-inline.json"), "--session-dir", dir])
		const altered = await problems()
		// when: restored to the verified bytes
		writeFileSync(join(dir, "report.inline.html"), inline)
		const matched = await problems()
		// then
		expect({ missing, altered, matched }).toEqual({
			missing: { exitCode: 1, codes: ["edition_unverified"] },
			altered: { exitCode: 1, codes: ["edition_unverified", "edition_unverified"] },
			matched: { exitCode: 0, codes: [] },
		})
	})
})
