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



describe("polish wiring under node", () => {
	test("#given the fixture edits #when fact polish-apply runs #then it exits 0, applies the wording edit, and rejects the numeral edit", () => {
		const { dir } = polishSession()
		const applied = polishApply(dir, join(FIDELITY, "polish-edits.json"))
		const polished = readFileSync(join(dir, "report.polished.html"), "utf8")
		expect(applied.code).toBe(0)
		expect(applied.json.data).toMatchObject({ applied: 1, rejected: 1, unlocated: 0 })
		expect(applied.json.defects.map((d) => [d.code, d.index])).toEqual([["polish_edit_rejected", 1]])
		expect(polished).toContain("Collected from a single cited public page")
		expect(polished).toContain("retrieved 2026-10-01")
		expect(polished).not.toContain("2026-10-02")
	})

	test("#given an edit that adds an attribute #when polish-apply and polish-diff run #then apply refuses it as markup changed and diff exits 1", () => {
		const { dir } = polishSession()
		const html = readFileSync(join(dir, "report.html"), "utf8")
		const edits = join(dir, "attribute.json")
		writeFileSync(edits, JSON.stringify([{ before: "<h2>Findings</h2>", after: '<h2 id="findings">Findings</h2>', reason: "anchor" }]))
		const applied = polishApply(dir, edits)
		expect(applied.code).toBe(0)
		expect(applied.json.data).toMatchObject({ applied: 0, rejected: 1, unlocated: 0 })
		expect(applied.json.defects.map((d) => [d.code, d.index])).toEqual([["polish_edit_rejected", 0]])
		expect(applied.json.defects[0]?.reason).toContain("markup changed")
		expect(readFileSync(join(dir, "report.polished.html"), "utf8")).toBe(html)
		writeFileSync(join(dir, "attribute.html"), html.replace("<h2>Findings</h2>", '<h2 id="findings">Findings</h2>'))
		const diffed = nodeJson(["fact", "polish-diff", "--before", join(dir, "report.html"), "--after", join(dir, "attribute.html"), "--ledger", join(dir, "fact-ledger.json"), "--session-dir", dir])
		expect(diffed.code).toBe(1)
		expect(codesOf(diffed.json)).toContain("polish_diff_fail")
		expect(JSON.stringify(diffed.json)).toContain("markup changed")
	})

	test("#given an edit whose before holds & #when fact polish-apply runs #then it prints polish-apply's own markup reason verbatim for that edit", () => {
		const { dir } = polishSession()
		const before = "Acme & Bolt"
		const edits = join(dir, "ampersand.json")
		writeFileSync(edits, JSON.stringify([{ before, after: "Acme and Bolt", reason: "ampersand" }]))
		const applied = polishApply(dir, edits)
		const line = `  rejected edit 0 ("${before}"): ${POLISH_MARKUP_REASON}`
		expect(applied.code).toBe(0)
		expect(applied.json.data).toMatchObject({ applied: 0, rejected: 1, unlocated: 0 })
		expect(applied.json.defects.map((d) => [d.code, d.index, d.reason])).toEqual([["polish_edit_rejected", 0, POLISH_MARKUP_REASON]])
		expect(applied.stderr.split("\n")).toContain(line)
	})

	test("#given a polished copy edited by hand #when fact polish-diff runs #then it exits 1 with polish_diff_fail", () => {
		const { dir } = polishSession()
		const html = readFileSync(join(dir, "report.html"), "utf8")
		writeFileSync(join(dir, "hand.html"), html.replace("320 m", "321 m"))
		const diffed = nodeJson(["fact", "polish-diff", "--before", join(dir, "report.html"), "--after", join(dir, "hand.html"), "--ledger", join(dir, "fact-ledger.json"), "--session-dir", dir])
		expect(diffed.code).toBe(1)
		expect(codesOf(diffed.json)).toContain("polish_diff_fail")
	})

	test("#given an accepted subject and object swap #when fact pairs runs with --changed-since #then only that sentence's pair is emitted, with the new text", () => {
		const { dir, s } = polishSession()
		const edits = join(dir, "swap.json")
		writeFileSync(edits, JSON.stringify([{ before: "Acme acquired Bolt", after: "Bolt acquired Acme", reason: "word order" }]))
		const applied = polishApply(dir, edits)
		const map = join(dir, "report.html.fill-map.json")
		const changed = nodeJson(["fact", "pairs", join(dir, "report.polished.html"), "--changed-since", map, "--out", join(dir, "pairs-changed.json"), ...s])
		const written = JSON.parse(readFileSync(join(dir, "pairs-changed.json"), "utf8"))
		expect(applied.json.data).toMatchObject({ applied: 1, rejected: 0 })
		expect(changed.code).toBe(0)
		expect(written.pairs.map((p: Pair) => [p.kind, p.fact_ids])).toEqual([["quote", ["F1"]]])
		expect(written.pairs[0].sentence).toContain("Bolt acquired Acme")
	})
})

describe("markdown editions under node", () => {
	const MD = ["# Bridge", "", "## Findings", "", "The span length is {{F1:span_len}} [S4].", "", "The operator wrote {{Q1:completion}} [S4].", "", "## How this report was made", "", "Collected from one cited public page [S4].", "", "## Sources", "", "1. [S4] Bridge page, retrieved 2026-10-01.", ""].join("\n")

	function mdSession() {
		const session = fidelitySession()
		writeFileSync(join(session.dir, "report.src.md"), MD)
		const filled = nodeJson(["fact", "fill", join(session.dir, "report.src.md"), "--format", "md", "--out", join(session.dir, "report.md"), ...session.s])
		return { ...session, filled }
	}

	test("#given a markdown source #when filled and verified as md #then verify passes and records the md bytes", () => {
		const { dir, filled } = mdSession()
		const checked = verify(dir, "report.md", ["--format", "md"])
		expect(filled.code).toBe(0)
		expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("The span length is 320 m [S4].")
		expect(checked.code).toBe(0)
		expect(checked.json.defects).toEqual([])
		expect(JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8")).artifact_sha256).toBe(sha256(join(dir, "report.md")))
	})

	test("#given a filled markdown edition #when a value is hand-edited or a number typed #then md verify exits 1 with the code", () => {
		const { dir } = mdSession()
		const md = readFileSync(join(dir, "report.md"), "utf8")
		writeFileSync(join(dir, "typed.md"), md.replace("## How", "Revenue grew 12% [S4].\n\n## How"))
		copyFileSync(join(dir, "report.md.fill-map.json"), join(dir, "typed.md.fill-map.json"))
		const typed = verify(dir, "typed.md", ["--format", "md"])
		expect(typed.code).toBe(1)
		expect(codesOf(typed.json)).toContain("untraceable_number")
	})

	test("#given a filled markdown edition with an unterminated fence #when verified or paired #then both refuse with exit 2", () => {
		const { dir, s } = mdSession()
		writeFileSync(join(dir, "fence.md"), `${readFileSync(join(dir, "report.md"), "utf8")}\n\`\`\`\nunclosed code\n`)
		copyFileSync(join(dir, "report.md.fill-map.json"), join(dir, "fence.md.fill-map.json"))
		const checked = verify(dir, "fence.md", ["--format", "md"])
		expect(checked.code).toBe(2)
		expect(checked.stderr).toContain("unterminated_fence")
		expect(nodeJson(["fact", "pairs", join(dir, "fence.md"), "--out", join(dir, "pairs.json"), ...s]).code).toBe(2)
	})

	test("#given a filled markdown edition #when fact pairs runs on it #then it pairs the same quotes as the html edition", () => {
		const { dir, s } = mdSession()
		const pairs = nodeJson(["fact", "pairs", join(dir, "report.md"), "--out", join(dir, "pairs.json"), ...s])
		expect(pairs.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8")).pairs.map((p: Pair) => p.fact_ids)).toEqual([["F1"], ["Q1"]])
	})
})

describe("repair decide with several defect files", () => {
	test("#given two --defects files #when decided #then the attempt signature carries both codes", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, "a.json", ["heading_generic"]), "--defects", defectsFile(dir, "b.json", ["untraceable_number"])])
		const signature = JSON.parse(readFileSync(state, "utf8")).attempts[0].signature
		expect(signature).toContain("heading_generic")
		expect(signature).toContain("untraceable_number")
	})
})
